// Measures the /simulation page against the idle and hidden budgets in
// web/perf/budget.json, in a real headless Chromium against the real server.
//
//   node web/perf/simulation-budget.mjs --binary ./fmlanes [--report out.json]
//
// Needs Playwright with a Chromium build on NODE_PATH.
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

const limits=JSON.parse(readFileSync(join(root,'web/perf/budget.json'),'utf8'));
const windowMs=4000;

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const binary=resolve(option('--binary')||join(root,'fmlanes'));
const reportPath=option('--report');

const freePort=()=>new Promise((ok,fail)=>{const server=createServer();server.unref();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>ok(port));});});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));

async function startServer(){
 const port=await freePort(),state=mkdtempSync(join(tmpdir(),'fmlanes-budget-'));
 const child=spawn(binary,['--home',join(root,'testdata/sample-home'),'--serve',`127.0.0.1:${port}`],{env:{...process.env,XDG_STATE_HOME:state,FM_LANES_CONFIG:''},stdio:['ignore','inherit','inherit']});
 const base=`http://127.0.0.1:${port}`,stop=()=>{child.kill();rmSync(state,{recursive:true,force:true});};
 for(let i=0;i<100;i++){
  if(child.exitCode!==null){stop();throw Error(`server exited with ${child.exitCode}`);}
  try{if((await fetch(`${base}/meshes.json`)).ok)return {base,stop};}catch{}
  await sleep(100);
 }
 stop();throw Error('server did not start');
}

// Lets the check hide and show the page as a background tab would.
function visibilityControl(){
 let hidden=false;
 Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
 Object.defineProperty(Document.prototype,'hidden',{configurable:true,get:()=>hidden});
 window.__setHidden=value=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
 // Counts ship frames: every paint of the holo canvas starts with one fill of its whole background.
 window.__frames=0;
 const fill=CanvasRenderingContext2D.prototype.fillRect;
 CanvasRenderingContext2D.prototype.fillRect=function(x,y,width,height){if(x===0&&y===0&&width>20&&this.canvas.matches('canvas[aria-label^="Rendered ship"]'))window.__frames++;return fill.call(this,x,y,width,height);};
}

async function measure(page,cdp,requests,ms,act){
 const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 // The status line and breakup readout together change on every simulation step.
 const label=()=>page.evaluate(()=>[...document.querySelectorAll('section[aria-label="Lane simulation"] p, section[aria-label="Lane simulation"] [aria-live]')].map(e=>e.textContent).join(' | '));
 if(act)await act();
 const before={frames:await page.evaluate(()=>window.__frames),requests:requests.length,label:await label(),metrics:await metric()};
 await sleep(ms);
 const after={frames:await page.evaluate(()=>window.__frames),requests:requests.length,label:await label(),metrics:await metric()};
 return {
  ms,frames:after.frames-before.frames,
  requests:requests.slice(before.requests,after.requests),
  labelBefore:before.label,labelAfter:after.label,
  scriptMs:Math.round((after.metrics.ScriptDuration-before.metrics.ScriptDuration)*1000),
  taskMs:Math.round((after.metrics.TaskDuration-before.metrics.TaskDuration)*1000),
 };
}

const results=[],check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'pass':'FAIL'}  ${name}  ${JSON.stringify(detail)}`);};

const report={limits,windowMs,results,measurements:{}};
let server,browser;
try{
 server=await startServer();
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1000,height:800}});
 await page.addInitScript(visibilityControl);
 const requests=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 await page.goto(`${server.base}/simulation`);
 await page.waitForFunction(()=>document.querySelector('canvas[aria-label^="Rendered ship"]')&&window.__frames>0);
 await sleep(500);

 const active=await measure(page,cdp,requests,windowMs);
 const fps=active.frames*1000/active.ms,scriptPerSecond=active.scriptMs*1000/active.ms;
 report.measurements.active={...active,framesPerSecond:+fps.toFixed(1),scriptMsPerSecond:Math.round(scriptPerSecond)};
 check('active spin stays within the frame budget',fps<=limits.maxActiveFramesPerSecond&&fps>=limits.minActiveFramesPerSecond,{framesPerSecond:+fps.toFixed(1),min:limits.minActiveFramesPerSecond,max:limits.maxActiveFramesPerSecond});
 check('active spin stays within the script budget',scriptPerSecond<=limits.activeScriptMsPerSecond,{scriptMsPerSecond:Math.round(scriptPerSecond),max:limits.activeScriptMsPerSecond});
 check('active simulation advances',active.labelBefore!==active.labelAfter,{from:active.labelBefore,to:active.labelAfter});

 const untouched=await measure(page,cdp,requests,windowMs,async()=>{
  await page.getByText('Failure · the debris has left the field').waitFor({timeout:20000});
  await sleep(200);
 });
 report.measurements.untouchedSettled=untouched;
 check('untouched settled page draws no ship frames',untouched.frames<=limits.settledFrames,{frames:untouched.frames});
 check('untouched settled page makes no requests',untouched.requests.length<=limits.idleRequests,{requests:untouched.requests});

 const restart=()=>page.getByRole('button',{name:'Restart',exact:true}).click();
 const hidden=await measure(page,cdp,requests,windowMs,async()=>{await restart();await page.evaluate(()=>window.__setHidden(true));});
 report.measurements.hidden=hidden;
 check('hidden page draws no ship frames',hidden.frames<=limits.hiddenFrames,{frames:hidden.frames});
 check('hidden page makes no requests',hidden.requests.length<=limits.hiddenRequests,{requests:hidden.requests});
 check('hidden page does not step the simulation',hidden.labelBefore===hidden.labelAfter,{from:hidden.labelBefore,to:hidden.labelAfter});
 check('hidden page stays within the script budget',hidden.scriptMs<=limits.hiddenScriptMs,{scriptMs:hidden.scriptMs,max:limits.hiddenScriptMs});

 const resumed=await measure(page,cdp,requests,windowMs,async()=>{await page.evaluate(()=>window.__setHidden(false));});
 report.measurements.resumed=resumed;
 check('visible again, spin and simulation resume',resumed.frames>0&&resumed.labelBefore!==resumed.labelAfter,{frames:resumed.frames,from:resumed.labelBefore,to:resumed.labelAfter});

 const idle=await measure(page,cdp,requests,windowMs,async()=>{
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Stop ship spin'}).click();
  await sleep(200);
 });
 report.measurements.idle=idle;
 check('idle page draws no ship frames',idle.frames<=limits.idleFrames,{frames:idle.frames});
 check('idle page makes no requests',idle.requests.length<=limits.idleRequests,{requests:idle.requests});
 check('idle page stays within the script budget',idle.scriptMs<=limits.idleScriptMs,{scriptMs:idle.scriptMs,max:limits.idleScriptMs});

 await page.getByRole('button',{name:'Failed',exact:true}).click();
 await page.getByText('Failure · the debris has left the field').waitFor({timeout:15000});
 const settled=await measure(page,cdp,requests,windowMs);
 report.measurements.settled=settled;
 check('settled breakup with spin stopped draws no ship frames',settled.frames<=limits.settledFrames,{frames:settled.frames});
 check('settled breakup makes no requests',settled.requests.length<=limits.idleRequests,{requests:settled.requests});

 const fleetReads=requests.filter(path=>path==='/fleet.json').length;
 check('simulation never reads the fleet',fleetReads<=limits.simulationFleetRequests,{fleetReads});
}finally{
 await browser?.close();server?.stop();
}
if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,1)+'\n');
const failed=results.filter(result=>!result.ok);
console.log(failed.length?`${failed.length} of ${results.length} budget checks failed`:`all ${results.length} budget checks passed`);
process.exit(failed.length?1:0);
