// Measures the /simulation page against the idle and hidden budgets in
// web/perf/budget.json, in a real headless Chromium against the real server.
//
//   node web/perf/simulation-budget.mjs --binary ./fmlanes [--report out.json]
//
// Needs Playwright with a Chromium build on NODE_PATH.
import {spawn} from 'node:child_process';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
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

// A copy of the sample home and its registered sample-mate, side by side, whose working lane is stamped now: lanes
// older than two hours are not working, so the committed fixture would show no hull in work and no drones. Extra lanes
// are copies of that working lane, so the yard and its bar carry about 100 real lanes.
function fixtureHome(extraLanes){
 const dir=mkdtempSync(join(tmpdir(),'fmlanes-home-')),home=join(dir,'sample-home');
 cpSync(join(root,'testdata/sample-home'),home,{recursive:true});
 cpSync(join(root,'testdata/sample-mate'),join(dir,'sample-mate'),{recursive:true});
 const status=join(home,'state/api-retry.status');
 writeFileSync(status,readFileSync(status,'utf8').replace(/\[at=\d+\]/g,`[at=${Math.floor(Date.now()/1000)}]`));
 const stamped=readFileSync(status,'utf8'),meta=readFileSync(join(home,'state/api-retry.meta'),'utf8');
 for(let i=0;i<extraLanes;i++){writeFileSync(join(home,'state',`lane-${i}.status`),stamped);writeFileSync(join(home,'state',`lane-${i}.meta`),meta);}
 return {dir,home};
}

async function startServer(extraLanes=0){
 const port=await freePort(),state=mkdtempSync(join(tmpdir(),'fmlanes-budget-')),{dir,home}=fixtureHome(extraLanes);
 const child=spawn(binary,['--home',home,'--serve',`127.0.0.1:${port}`],{env:{...process.env,XDG_STATE_HOME:state,FM_LANES_CONFIG:''},stdio:['ignore','inherit','inherit']});
 const base=`http://127.0.0.1:${port}`,stop=()=>{child.kill();rmSync(state,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});};
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
 // Counts ship frames: every paint of a holo canvas or the shipyard canvas starts with one fill of its whole background.
 // The shipyard counts apart, so a side-panel ship never inflates the yard's count.
 window.__frames=0;window.__yardFrames=0;
 const fill=CanvasRenderingContext2D.prototype.fillRect;
 CanvasRenderingContext2D.prototype.fillRect=function(x,y,width,height){if(x===0&&y===0&&width>20){if(this.canvas.matches('canvas[aria-label^="Rendered ship"]'))window.__frames++;else if(this.canvas.matches('canvas[aria-label^="Shipyard:"]'))window.__yardFrames++;}return fill.call(this,x,y,width,height);};
}

async function measure(page,cdp,requests,ms,act,during){
 const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 // The status line and breakup readout together change on every simulation step.
 const label=()=>page.evaluate(()=>[...document.querySelectorAll('section[aria-label="Lane simulation"] p, section[aria-label="Lane simulation"] [aria-live]')].map(e=>e.textContent).join(' | '));
 if(act)await act();
 const before={frames:await page.evaluate(()=>window.__frames),yardFrames:await page.evaluate(()=>window.__yardFrames),requests:requests.length,label:await label(),metrics:await metric()};
 await (during?during(ms):sleep(ms));
 const after={frames:await page.evaluate(()=>window.__frames),yardFrames:await page.evaluate(()=>window.__yardFrames),requests:requests.length,label:await label(),metrics:await metric()};
 return {
  ms,frames:after.frames-before.frames,yardFrames:after.yardFrames-before.yardFrames,
  requests:requests.slice(before.requests,after.requests),
  labelBefore:before.label,labelAfter:after.label,
  scriptMs:Math.round((after.metrics.ScriptDuration-before.metrics.ScriptDuration)*1000),
  taskMs:Math.round((after.metrics.TaskDuration-before.metrics.TaskDuration)*1000),
 };
}

const results=[],check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'pass':'FAIL'}  ${name}  ${JSON.stringify(detail)}`);};

async function openShipyard(page,base){
 const fleetLoaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/fleet.json');
 await page.goto(`${base}/`);
 await fleetLoaded;
 await page.waitForFunction(()=>!document.querySelector('main[role="status"]'));
 await page.locator('nav.rail').getByRole('button',{name:/^Fleet/}).click();
 await page.waitForSelector('section[aria-label="Fleet"]');
 await page.getByRole('group',{name:'Fleet display'}).getByRole('button',{name:'Shipyard',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('canvas[aria-label^="Shipyard:"]')&&window.__yardFrames>0);
 await fitAll(page);
}

const fitAll=page=>page.getByRole('group',{name:'Yard zoom'}).getByRole('button',{name:'fit all'}).click();

// The shipyard ends inside the frame and the station does not scroll at 1440 x 900 and 1280 x 720, with the sample's lanes
// and with about 100 lanes, after fit all at each size.
async function checkShipyardFit(browser,extraLanes){
 const server=await startServer(extraLanes),page=await browser.newPage({viewport:{width:1440,height:900}});
 try{
  await page.addInitScript(visibilityControl);
  await openShipyard(page,server.base);
  const lanes=Number((await page.locator('section[aria-label="Fleet"] .vtitle .lab').textContent()).match(/\d+/)[0]);
  check(`fleet shows the ${extraLanes} extra lanes`,lanes>=extraLanes,{lanes,extraLanes});
  for(const [width,height] of [[1440,900],[1280,720]]){
   await page.setViewportSize({width,height});await sleep(300);
   await fitAll(page);await sleep(300);
   const fit=await page.evaluate(()=>{const main=document.querySelector('main.main'),yard=document.querySelector('canvas[aria-label^="Shipyard:"]');return {yardBottom:Math.round(yard.getBoundingClientRect().bottom),frameBottom:Math.round(main.getBoundingClientRect().bottom),stationScroll:main.scrollHeight-main.clientHeight};});
   check(`shipyard fits the frame at ${width} x ${height} with ${lanes} lanes`,fit.yardBottom<=fit.frameBottom&&fit.stationScroll<=0,fit);
  }
 }finally{
  await page.close();server.stop();
 }
}

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

 // The Fleet shipyard: the default state first (Motion on, two drones, the side ship spinning), then with the side ship
 // stopped so each yard window measures the yard alone: a drag, the drones, Motion off, then hidden.
 const combinedRates=m=>({panelFramesPerSecond:+(m.frames*1000/m.ms).toFixed(1),yardFramesPerSecond:+(m.yardFrames*1000/m.ms).toFixed(1),scriptMsPerSecond:Math.round(m.scriptMs*1000/m.ms)});
 await openShipyard(page,server.base);
 await sleep(500);
 const combined=await measure(page,cdp,requests,windowMs);
 const rates=combinedRates(combined);
 report.measurements.shipyardCombined={...combined,...rates};
 check('shipyard with drones and the side ship spinning stays within the frame budgets',[rates.panelFramesPerSecond,rates.yardFramesPerSecond].every(fps=>fps>=limits.minActiveFramesPerSecond&&fps<=limits.maxActiveFramesPerSecond),rates);
 check('shipyard with drones and the side ship spinning stays within the script budget',rates.scriptMsPerSecond<=limits.activeScriptMsPerSecond,rates);
 await page.getByRole('button',{name:'Stop ship spin'}).click();
 await sleep(500);
 const yardBox=await page.locator('canvas[aria-label^="Shipyard:"]').boundingBox();
 const dragYard=async ms=>{
  const x=yardBox.x+yardBox.width/2,y=yardBox.y+yardBox.height/2,end=Date.now()+ms;
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=0;Date.now()<end;i++)await page.mouse.move(x+(i%2?30:-30),y);
  await page.mouse.up();
 };
 const perSecond=m=>({framesPerSecond:+(m.yardFrames*1000/m.ms).toFixed(1),scriptMsPerSecond:Math.round(m.scriptMs*1000/m.ms)});
 const drag=await measure(page,cdp,requests,windowMs,undefined,dragYard);
 report.measurements.shipyardDrag={...drag,...perSecond(drag)};
 check('shipyard drag stays within the frame budget',perSecond(drag).framesPerSecond>=limits.minActiveFramesPerSecond&&perSecond(drag).framesPerSecond<=limits.maxActiveFramesPerSecond,perSecond(drag));
 check('shipyard drag stays within the script budget',perSecond(drag).scriptMsPerSecond<=limits.activeScriptMsPerSecond,perSecond(drag));

 const drones=await measure(page,cdp,requests,windowMs);
 report.measurements.shipyardDrones={...drones,...perSecond(drones)};
 check('shipyard drones fly and stay within the frame budget',perSecond(drones).framesPerSecond>=limits.minActiveFramesPerSecond&&perSecond(drones).framesPerSecond<=limits.maxActiveFramesPerSecond,perSecond(drones));
 check('shipyard drones stay within the script budget',perSecond(drones).scriptMsPerSecond<=limits.activeScriptMsPerSecond,perSecond(drones));

 const still=await measure(page,cdp,requests,windowMs,async()=>{await page.keyboard.press('m');await sleep(200);});
 report.measurements.shipyardMotionOff=still;
 check('shipyard with Motion off draws no frames',still.yardFrames<=limits.idleFrames,{frames:still.yardFrames});
 check('shipyard with Motion off stays within the script budget',still.scriptMs<=limits.idleScriptMs,{scriptMs:still.scriptMs,max:limits.idleScriptMs});

 const yardHidden=await measure(page,cdp,requests,windowMs,async()=>{await page.keyboard.press('m');await page.evaluate(()=>window.__setHidden(true));});
 report.measurements.shipyardHidden=yardHidden;
 check('hidden shipyard draws no frames',yardHidden.yardFrames<=limits.hiddenFrames,{frames:yardHidden.yardFrames});
 // The board's own 3 s /fleet.json poll keeps the reading's age current and is not the yard's: only other requests count.
 const yardRequests=yardHidden.requests.filter(path=>path!=='/fleet.json');
 check('hidden shipyard makes no requests of its own',yardRequests.length<=limits.hiddenRequests,{requests:yardRequests});
 check('hidden shipyard stays within the script budget',yardHidden.scriptMs<=limits.hiddenScriptMs,{scriptMs:yardHidden.scriptMs,max:limits.hiddenScriptMs});

 await checkShipyardFit(browser,0);
 await checkShipyardFit(browser,100);
}finally{
 await browser?.close();server?.stop();
}
if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,1)+'\n');
const failed=results.filter(result=>!result.ok);
console.log(failed.length?`${failed.length} of ${results.length} budget checks failed`:`all ${results.length} budget checks passed`);
process.exit(failed.length?1:0);
