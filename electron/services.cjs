const { load } = require('cheerio');
const { URL } = require('node:url');
const dns = require('node:dns').promises;
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog, app } = require('electron');

function cleanText(v) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 20000); }
function normalizeDomain(host) { return host.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); }
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) { const p=ip.split('.').map(Number); return p[0]===10 || p[0]===127 || p[0]===0 || (p[0]===169&&p[1]===254) || (p[0]===172&&p[1]>=16&&p[1]<=31) || (p[0]===192&&p[1]===168) || p[0]>=224; }
  if (net.isIPv6(ip)) { const x=ip.toLowerCase(); return x==='::1' || x==='::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80:') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.'); }
  return true;
}
async function validatePublicUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new Error('Enter a valid absolute URL.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (u.username || u.password) throw new Error('URLs containing credentials are not allowed.');
  if (u.port && !['80','443'].includes(u.port)) throw new Error('Only standard HTTP/HTTPS ports are allowed.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Local and internal hosts are blocked.');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('Private or reserved IP addresses are blocked.'); }
  else {
    let results; try { results = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw new Error('The host could not be resolved.'); }
    if (!results.length || results.some(r => isPrivateIp(r.address))) throw new Error('Hosts resolving to private or reserved addresses are blocked.');
  }
  u.hash = '';
  return u;
}
function getProject(db, id) { const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id); if (!p) throw new Error('Project not found.'); return p; }
function getSettings(db, id) { const s = db.prepare('SELECT * FROM project_settings WHERE project_id=?').get(id); return s || { allowed_domains:'[]', request_delay_ms:1500, max_pages:20, max_depth:1, max_response_bytes:2000000 }; }
function allowedHost(host, domains) { const d=normalizeDomain(host); return domains.some(x => { const n=normalizeDomain(x.trim()); return n && (d===n || d.endsWith('.'+n)); }); }
async function fetchHtml(db, projectId, rawUrl) {
  getProject(db, projectId); const settings=getSettings(db, projectId); const domains=JSON.parse(settings.allowed_domains || '[]');
  let current = await validatePublicUrl(rawUrl);
  if (!allowedHost(current.hostname, domains)) throw new Error(`Domain ${current.hostname} is not allowlisted for this project. Add it in Project Settings first.`);
  let response;
  for (let hop=0; hop<4; hop++) {
    current = await validatePublicUrl(current.href);
    if (!allowedHost(current.hostname, domains)) throw new Error('Redirect target is outside the project domain allowlist.');
    const controller = new AbortController(); const timer=setTimeout(()=>controller.abort(), 15000);
    try {
      response = await fetch(current.href, { method:'GET', redirect:'manual', signal:controller.signal, headers:{ 'User-Agent':'JASS-Web-Intelligence-Studio/0.1 (+local research tool)', 'Accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2' } });
    } catch (e) { throw new Error(e.name==='AbortError'?'Request timed out after 15 seconds.':`Fetch failed: ${e.message}`); }
    finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(response.status)) { const loc=response.headers.get('location'); if(!loc) throw new Error('Redirect response had no location.'); if(hop===3) throw new Error('Too many redirects.'); current=new URL(loc,current); continue; }
    break;
  }
  if (!response) throw new Error('No response received.');
  const type=response.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('text/html') && !type.toLowerCase().includes('application/xhtml+xml')) throw new Error(`Expected HTML, received ${type || 'unknown content type'}.`);
  const declared=Number(response.headers.get('content-length') || 0); if(declared > settings.max_response_bytes) throw new Error('Response exceeds the configured size limit.');
  const reader=response.body.getReader(); const chunks=[]; let total=0;
  while(true) { const {done,value}=await reader.read(); if(done) break; total+=value.byteLength; if(total>settings.max_response_bytes){ await reader.cancel(); throw new Error('Response exceeded the configured size limit while downloading.'); } chunks.push(Buffer.from(value)); }
  const html=Buffer.concat(chunks).toString('utf8');
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const $=load(html); $('script,iframe,object,embed,form').remove();
  return { url:current.href, status:response.status, contentType:type, html, title:cleanText($('title').first().text()) || current.hostname, text:cleanText($('body').text()).slice(0,12000), links:$('a[href]').toArray().slice(0,300).map(el=>({text:cleanText($(el).text()).slice(0,250),href:(()=>{try{return new URL($(el).attr('href'),current.href).href}catch{return ''}})()})).filter(x=>x.href.startsWith('http')), fetchedAt:new Date().toISOString() };
}
function extractRows(html, selectors, baseUrl) {
  const $=load(html); $('script,iframe,object,embed').remove();
  if (!Array.isArray(selectors) || selectors.length===0) throw new Error('Add at least one extraction field.');
  const parsed=selectors.map((s,i)=>{ const name=cleanText(s.name); const selector=String(s.selector||'').trim(); if(!name) throw new Error(`Field ${i+1} needs a name.`); if(!selector) throw new Error(`Field ${i+1} needs a CSS selector.`); try{$(selector).length;}catch(e){throw new Error(`Invalid selector for “${name}”: ${e.message}`)} return {name,selector,attribute:s.attribute||'text'}; });
  const counts=parsed.map(f=>$(f.selector).length); const max=Math.max(...counts,0); if(max===0) throw new Error('No elements matched the configured selectors. Check the CSS selectors and fetched HTML.');
  const rows=[]; for(let i=0;i<Math.min(max,1000);i++){const row={}; for(let j=0;j<parsed.length;j++){const f=parsed[j],el=$(f.selector).eq(i); let value=''; if(el.length){if(f.attribute==='href'||f.attribute==='src'){const v=el.attr(f.attribute); try{value=v?new URL(v,baseUrl).href:''}catch{value=v||''}}else if(f.attribute==='html') value=el.html()||''; else value=cleanText(el.text());} row[f.name]=String(value).slice(0,20000);} if(Object.values(row).some(v=>v!=='')) rows.push(row); }
  return { rows, fieldCounts:parsed.map((f,i)=>({name:f.name,selector:f.selector,matches:counts[i]})), warnings:counts.some(c=>c!==max)?['Selectors matched different numbers of elements; blank cells were filled where a field had fewer matches.']:[], truncated:max>1000 };
}
async function crawlAndExtract(db, projectId, seedUrl, selectors) {
  getProject(db, projectId);
  const settings = getSettings(db, projectId);
  const domains = JSON.parse(settings.allowed_domains || '[]');
  if (!domains.length) throw new Error('Add at least one domain to the project allowlist before crawling.');
  const maxPages = Math.max(1, Math.min(100, Number(settings.max_pages) || 20));
  const maxDepth = Math.max(0, Math.min(3, Number(settings.max_depth) || 0));
  const seed = await validatePublicUrl(seedUrl);
  if (!allowedHost(seed.hostname, domains)) throw new Error('The starting URL is outside the project allowlist.');
  const queue = [{ url: seed.href, depth: 0 }];
  const seen = new Set();
  const pages = [];
  const rows = [];
  let fieldCounts = [];
  const warnings = [];
  while (queue.length && seen.size < maxPages) {
    const item = queue.shift();
    let normalized;
    try { normalized = await validatePublicUrl(item.url); } catch { continue; }
    normalized.hash = '';
    const key = normalized.href;
    if (seen.has(key) || !allowedHost(normalized.hostname, domains)) continue;
    seen.add(key);
    if (pages.length > 0) await new Promise(resolve => setTimeout(resolve, Math.max(1000, Math.min(60000, Number(settings.request_delay_ms) || 1500))));
    let page;
    try { page = await fetchHtml(db, projectId, key); }
    catch (e) { warnings.push(`${key}: ${e.message}`); continue; }
    pages.push({ url: page.url, title: page.title, status: page.status, depth: item.depth, hash: crypto.createHash('sha256').update(page.html).digest('hex') });
    try {
      const extracted = extractRows(page.html, selectors, page.url);
      if (!fieldCounts.length) fieldCounts = extracted.fieldCounts;
      extracted.rows.forEach(row => rows.push({ ...row, _source_url: page.url, _page_title: page.title }));
      warnings.push(...extracted.warnings.map(w => `${page.url}: ${w}`));
    } catch (e) { warnings.push(`${page.url}: extraction failed — ${e.message}`); }
    if (item.depth < maxDepth && pages.length < maxPages) {
      for (const link of page.links) {
        if (queue.length + pages.length >= maxPages * 4) break;
        try {
          const u = await validatePublicUrl(link.href);
          u.hash = '';
          if (allowedHost(u.hostname, domains) && !seen.has(u.href) && !queue.some(q => q.url === u.href)) queue.push({ url: u.href, depth: item.depth + 1 });
        } catch { /* Skip unsafe, malformed or non-public destinations. */ }
      }
    }
  }
  if (!pages.length) throw new Error(warnings[0] || 'No pages could be fetched within the configured limits.');
  return { seedUrl: seed.href, pages, rows: rows.slice(0, 1000), fieldCounts, warnings, truncated: rows.length > 1000, combinedHash: crypto.createHash('sha256').update(pages.map(p => p.hash).join(':')).digest('hex') };
}

function registerIpc(ipcMain, db) {
  const wrap = fn => async (_event, data) => { try { return { ok:true, data:await fn(data||{}) }; } catch(e) { return { ok:false, error:e.message || 'Unexpected error' }; } };
  ipcMain.handle('dashboard', wrap(async()=>({projects:db.prepare('SELECT COUNT(*) n FROM projects').get().n,targets:db.prepare('SELECT COUNT(*) n FROM targets').get().n,runs:db.prepare('SELECT COUNT(*) n FROM extraction_runs').get().n,records:db.prepare('SELECT COUNT(*) n FROM records').get().n,latest:db.prepare('SELECT r.id,r.url,r.page_title,r.fetched_at,p.name project_name FROM extraction_runs r JOIN projects p ON p.id=r.project_id ORDER BY r.id DESC LIMIT 6').all()})));
  ipcMain.handle('projects:list', wrap(async()=>db.prepare('SELECT p.*, (SELECT COUNT(*) FROM targets t WHERE t.project_id=p.id) target_count, (SELECT COUNT(*) FROM records r WHERE r.project_id=p.id) record_count FROM projects p ORDER BY p.updated_at DESC,p.id DESC').all()));
  ipcMain.handle('projects:create', wrap(async({name,description})=>{if(!String(name||'').trim())throw new Error('Project name is required.'); const info=db.prepare('INSERT INTO projects(name,description) VALUES(?,?)').run(String(name).trim().slice(0,120),String(description||'').trim().slice(0,1000));db.prepare('INSERT INTO project_settings(project_id) VALUES(?)').run(info.lastInsertRowid);return db.prepare('SELECT * FROM projects WHERE id=?').get(info.lastInsertRowid);}));
  ipcMain.handle('projects:update', wrap(async({id,name,description})=>{getProject(db,id);if(!String(name||'').trim())throw new Error('Project name is required.');db.prepare('UPDATE projects SET name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(name).trim().slice(0,120),String(description||'').trim().slice(0,1000),id);return db.prepare('SELECT * FROM projects WHERE id=?').get(id);}));
  ipcMain.handle('projects:delete', wrap(async({id})=>{db.prepare('DELETE FROM projects WHERE id=?').run(id);return true;}));
  ipcMain.handle('targets:list', wrap(async({projectId})=>db.prepare('SELECT * FROM targets WHERE project_id=? ORDER BY id DESC').all(projectId)));
  ipcMain.handle('targets:add', wrap(async({projectId,url,label})=>{getProject(db,projectId);const u=await validatePublicUrl(url);const s=getSettings(db,projectId);const domains=JSON.parse(s.allowed_domains||'[]');if(!allowedHost(u.hostname,domains))throw new Error(`Add ${normalizeDomain(u.hostname)} to the domain allowlist in Settings before saving this target.`);const info=db.prepare('INSERT INTO targets(project_id,url,domain,label) VALUES(?,?,?,?)').run(projectId,u.href,normalizeDomain(u.hostname),String(label||'').trim().slice(0,120));return db.prepare('SELECT * FROM targets WHERE id=?').get(info.lastInsertRowid);}));
  ipcMain.handle('targets:remove', wrap(async({id})=>{db.prepare('DELETE FROM targets WHERE id=?').run(id);return true;}));
  ipcMain.handle('settings:get', wrap(async({projectId})=>{getProject(db,projectId);const s=getSettings(db,projectId);return {...s,allowed_domains:JSON.parse(s.allowed_domains||'[]')};}));
  ipcMain.handle('settings:save', wrap(async({projectId,allowedDomains,requestDelayMs,maxPages,maxDepth,maxResponseBytes})=>{getProject(db,projectId);const domains=[...new Set((allowedDomains||[]).map(x=>normalizeDomain(String(x).trim())).filter(Boolean))];if(domains.some(x=>x.includes('/')||x.includes(':')||x.includes(' ')))throw new Error('Enter domains only, such as example.com, not URLs or paths.');const delay=Math.max(1000,Math.min(60000,Number(requestDelayMs)||1500));const pages=Math.max(1,Math.min(100,Number(maxPages)||20));const depth=Math.max(0,Math.min(3,Number(maxDepth)||0));const bytes=Math.max(100000,Math.min(5000000,Number(maxResponseBytes)||2000000));db.prepare(`INSERT INTO project_settings(project_id,allowed_domains,request_delay_ms,max_pages,max_depth,max_response_bytes,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(project_id) DO UPDATE SET allowed_domains=excluded.allowed_domains,request_delay_ms=excluded.request_delay_ms,max_pages=excluded.max_pages,max_depth=excluded.max_depth,max_response_bytes=excluded.max_response_bytes,updated_at=CURRENT_TIMESTAMP`).run(projectId,JSON.stringify(domains),delay,pages,depth,bytes);return {allowed_domains:domains,request_delay_ms:delay,max_pages:pages,max_depth:depth,max_response_bytes:bytes};}));
  ipcMain.handle('extract:fetch', wrap(async({projectId,url})=>{const s=getSettings(db,projectId);const last=db.prepare('SELECT fetched_at FROM extraction_runs WHERE project_id=? ORDER BY fetched_at DESC LIMIT 1').get(projectId);if(last){const wait=Number(s.request_delay_ms)-(Date.now()-new Date(last.fetched_at+'Z').getTime());if(wait>0)await new Promise(r=>setTimeout(r,Math.min(wait,60000)));}return fetchHtml(db,projectId,url);}));
  ipcMain.handle('extract:preview', wrap(async({html,selectors,url})=>extractRows(String(html||''),selectors,url)));
  ipcMain.handle('extract:crawl', wrap(async({projectId,url,selectors})=>crawlAndExtract(db,projectId,url,selectors)));
  ipcMain.handle('extract:save', wrap(async({projectId,targetId,url,title,status,html,selectors,rows})=>{getProject(db,projectId);if(!Array.isArray(rows)||!rows.length)throw new Error('There are no extracted rows to save.');const hash=crypto.createHash('sha256').update(String(html||'')).digest('hex');const tx=db.transaction(()=>{const run=db.prepare('INSERT INTO extraction_runs(project_id,target_id,url,page_title,http_status,content_hash,selector_config,records_json) VALUES(?,?,?,?,?,?,?,?)').run(projectId,targetId||null,String(url),String(title||'').slice(0,500),Number(status)||null,hash,JSON.stringify(selectors||[]),JSON.stringify(rows));const insert=db.prepare('INSERT INTO records(project_id,run_id,row_index,source_url,data_json) VALUES(?,?,?,?,?)');rows.slice(0,1000).forEach((row,i)=>insert.run(projectId,run.lastInsertRowid,i,String(row._source_url||url),JSON.stringify(row)));db.prepare('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(projectId);return {runId:run.lastInsertRowid,count:Math.min(rows.length,1000),hash};});return tx();}));
  ipcMain.handle('records:list', wrap(async({projectId})=>db.prepare('SELECT r.id,r.run_id,r.row_index,r.source_url,r.data_json,r.created_at,e.page_title,e.fetched_at FROM records r JOIN extraction_runs e ON e.id=r.run_id WHERE r.project_id=? ORDER BY r.id DESC LIMIT 2000').all(projectId).map(r=>({...r,data:JSON.parse(r.data_json)}))));
  ipcMain.handle('snapshots:list', wrap(async({projectId})=>db.prepare('SELECT id,project_id,target_id,url,page_title,http_status,content_hash,fetched_at,records_json FROM extraction_runs WHERE project_id=? ORDER BY id DESC LIMIT 200').all(projectId).map(r=>({...r,record_count:JSON.parse(r.records_json||'[]').length}))));
  ipcMain.handle('snapshots:compare', wrap(async({olderId,newerId})=>{const a=db.prepare('SELECT * FROM extraction_runs WHERE id=?').get(olderId),b=db.prepare('SELECT * FROM extraction_runs WHERE id=?').get(newerId);if(!a||!b)throw new Error('Select two valid snapshots.');const aa=JSON.parse(a.records_json||'[]'),bb=JSON.parse(b.records_json||'[]');const key=x=>JSON.stringify(x);const ac=new Map(aa.map(x=>[key(x),x])),bc=new Map(bb.map(x=>[key(x),x]));return {older:{id:a.id,url:a.url,title:a.page_title,fetched_at:a.fetched_at},newer:{id:b.id,url:b.url,title:b.page_title,fetched_at:b.fetched_at},added:bb.filter(x=>!ac.has(key(x))),removed:aa.filter(x=>!bc.has(key(x))),unchanged:bb.filter(x=>ac.has(key(x))).length,hashChanged:a.content_hash!==b.content_hash};}));
  ipcMain.handle('records:export', wrap(async({projectId,format})=>{getProject(db,projectId);const rows=db.prepare('SELECT source_url,created_at,data_json FROM records WHERE project_id=? ORDER BY id').all(projectId).map(r=>({source_url:r.source_url,created_at:r.created_at,...JSON.parse(r.data_json)}));if(!rows.length)throw new Error('No records to export yet.');const result=await dialog.showSaveDialog({defaultPath:path.join(app.getPath('documents'),`jass-web-records-${Date.now()}.${format==='json'?'json':'csv'}`),filters:[{name:format==='json'?'JSON':'CSV',extensions:[format==='json'?'json':'csv']}]});if(result.canceled||!result.filePath)return {cancelled:true};let content;if(format==='json')content=JSON.stringify(rows,null,2);else{const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];const esc=v=>{let s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};content=[keys.map(esc).join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\r\n');}await fs.writeFile(result.filePath,content,'utf8');return {path:result.filePath,count:rows.length};}));
  ipcMain.handle('open-external', wrap(async({url})=>{const u=await validatePublicUrl(url);await shell.openExternal(u.href);return true;}));
}
module.exports = { registerIpc };
