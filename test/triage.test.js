import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../code.gs',import.meta.url),'utf8');
function harness() {
  const props=new Map([['OPENAI_MODEL','configured-fixture-model']]), tables={};
  const c=vm.createContext({Date,console:{log(){},error(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||'',setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},UrlFetchApp:{fetch(){throw Error('Live networking forbidden');}}});
  vm.runInContext(code,c);Object.keys(c.MCR.schemas).forEach(k=>tables[k]=[]);
  c.today_=()=> '2026-09-20';c.withLock_=fn=>fn();c.rows_=k=>structuredClone(tables[k]||[]);c.replaceRows_=(k,v)=>tables[k]=structuredClone(Array.from(v));
  c.setting_=k=>c.MCR.defaults[k];c.aiBudget_=()=>{};
  c.openAIJson_=()=>{throw Error('AI not mocked')};
  return {c,props,tables};
}
const event=(extra={})=>({ID:'tm_1',Source:'ticketmaster','Event Name':'Community market',Date:'2026-09-25',Time:'19:00',Venue:'Hall',Area:'Manchester',Category:'',URL:'https://example.test/event',Include:false,Triage:'Unreviewed','Triage Reason':'','Active (Y/N)':'Y','Ignored (Y/N)':'N',Feedback:'',...extra});
function mockAI(c,decision='include') {const sizes=[];c.openAIJson_=(_system,input)=>{const batch=JSON.parse(input[0].content);sizes.push(batch.length);return {decisions:batch.map(x=>({index:x.index,decision,reason:'Supplied facts support decision.'}))};};return sizes;}
test('current main-derived Apps Script parses',()=>{new vm.Script(code);});
test('all three sources automatically include obvious public interactive gatherings',()=>{
 const {c,tables}=harness();for(const [i,Source] of ['ticketmaster','instagram','eventbrite'].entries()) c.storeDiscovered_([event({ID:'id'+i,Source,'Event Name':'Community market '+i})]);
 assert.equal(tables.CityEvents.length,3);assert.ok(tables.CityEvents.every(e=>e.Include&&e.Triage==='Auto included'));
 assert.equal(c.eligibleEvents_(tables.CityEvents,'2026-09-20','2026-10-01',[]).length,3);
});
test('obvious unsuitable events reject without AI; uncertainty fails closed',()=>{
 const {c,tables}=harness();tables.CityEvents=['Children workshop','Private networking','Online-only fair','Seated concert','Football match'].map((name,i)=>event({ID:String(i),'Event Name':name}));tables.CityEvents.push(event({ID:'cancel','Active (Y/N)':'N'}),event({ID:'unknown',Venue:''}));c.triageCityEvents_();
 assert.ok(tables.CityEvents.every(e=>!e.Include));assert.ok(tables.CityEvents.slice(0,6).every(e=>e.Triage==='Auto rejected'));assert.equal(tables.CityEvents[6].Triage,'Auto uncertain');
});
test('ambiguous events use batches of at most 20 and never alter provider facts',()=>{
 const {c,tables}=harness();const sizes=mockAI(c);tables.CityEvents=Array.from({length:45},(_,i)=>event({ID:String(i),'Event Name':'Gathering '+i}));const before=structuredClone(tables.CityEvents);c.triageCityEvents_();assert.deepEqual(sizes,[20,20,5]);
 tables.CityEvents.forEach((e,i)=>{assert.equal(e.Include,true);for(const k of ['ID','Source','Event Name','Date','Time','Venue','Area','URL','Category']) assert.equal(e[k],before[i][k]);});
 c.triageCityEvents_();assert.deepEqual(sizes,[20,20,5]);
});
test('AI uncertain and reject decisions are excluded and auditable',()=>{
 for(const decision of ['uncertain','reject']) {const {c,tables}=harness();mockAI(c,decision);tables.CityEvents=[event({'Event Name':'Gathering'})];c.triageCityEvents_();assert.equal(tables.CityEvents[0].Include,false);assert.match(tables.CityEvents[0]['Triage Reason'],/Supplied facts/);}
});
test('AI missing model, failures, malformed or duplicate decisions fail closed',()=>{
 for(const failure of ['model','network','malformed','duplicate']) {const {c,props,tables}=harness();tables.CityEvents=[event({'Event Name':'Gathering'}),event({ID:'2','Event Name':'Another gathering'})];
 if(failure==='model')props.delete('OPENAI_MODEL');
 c.openAIJson_=()=>{if(failure==='network')throw Error('failure');return {decisions:failure==='duplicate'?[{index:0,decision:'include',reason:'x'},{index:0,decision:'include',reason:'x'}]:[]};};
 c.triageCityEvents_();assert.ok(tables.CityEvents.every(e=>!e.Include&&e.Triage==='Auto uncertain'));}
});
test('explicit ignored events and ignore-list matches never reach AI or become included',()=>{
 const {c,tables}=harness();const sizes=mockAI(c);tables.CityEvents=[event({'Ignored (Y/N)':'Y'}),event({ID:'eb_1',Source:'eventbrite'})];tables['Event Ignore List']=[event()];c.triageCityEvents_();assert.deepEqual(sizes,[]);assert.ok(tables.CityEvents.every(e=>!e.Include));
 assert.equal(c.mergeEvents_([],[event({ID:'ig_1'})],tables['Event Ignore List']).length,0);
});
test('owner approvals, explicit rejections, feedback and checkbox overrides survive',()=>{
 const {c,tables}=harness();const originals=[event({Include:true}),event({ID:'2',Triage:'Owner rejected'}),event({ID:'3',Feedback:'Do not use'}),event({ID:'4',Triage:'Auto included',Include:false}),event({ID:'5',Triage:'Auto rejected',Include:true}),event({ID:'6',Source:'forwarded'})];
 tables.CityEvents=structuredClone(originals);c.storeDiscovered_(originals.map(e=>({...e,'Event Name':'Changed'})));assert.deepEqual(tables.CityEvents,originals);
});
test('deduplication and blank checkbox protection survive automatic inclusion',()=>{
 const {c,tables}=harness();tables.CityEvents=Array.from({length:300},()=>({Include:false}));c.storeDiscovered_([event(),event({ID:'eb_1',Source:'eventbrite'})]);assert.equal(tables.CityEvents.length,1);assert.equal(tables.CityEvents[0].Include,true);c.storeDiscovered_([event()]);assert.equal(tables.CityEvents.length,1);
});
test('changed provider facts invalidate automatic decision but not manual decision',()=>{
 const {c,tables}=harness();c.storeDiscovered_([event()]);c.storeDiscovered_([event({'Active (Y/N)':'N'})]);assert.equal(tables.CityEvents[0].Include,false);assert.equal(tables.CityEvents[0].Triage,'Auto rejected');
});
test('owner edits during AI call and new ignores are preserved on re-read',()=>{
 const {c,tables}=harness();tables.CityEvents=[event({'Event Name':'Gathering'})];c.openAIJson_=()=>{tables.CityEvents[0].Feedback='Owner rejected';tables['Event Ignore List']=[event()];return {decisions:[{index:0,decision:'include',reason:'x'}]};};c.triageCityEvents_();assert.equal(tables.CityEvents[0].Include,false);assert.equal(tables.CityEvents[0].Feedback,'Owner rejected');
});
test('Ticketmaster ingestion automatically triages and keeps diagnostics',()=>{
 const {c,props,tables}=harness();props.set('TICKETMASTER_API_KEY','fixture');c.fetchJson_=()=>({page:{totalPages:1},_embedded:{events:[{id:'1',name:'Community market',dates:{start:{localDate:'2026-09-25',localTime:'19:00'}},_embedded:{venues:[{name:'Hall',city:{name:'Manchester'}}]}}]}});
 assert.match(c.refreshTicketmasterEvents(),/automatic suitability/);assert.equal(tables.CityEvents[0].Include,true);
});
test('Eventbrite page is batched before AI triage',()=>{
 const {c,tables}=harness();const sizes=mockAI(c);c.saveJob_('eventbrite',{id:'fixture',phase:'RUNNING',offset:0,start:'2026-09-20',end:'2026-10-01'});c.apify_=()=>({data:{status:'SUCCEEDED',defaultDatasetId:'fixture'}});c.datasetItems_=()=>Array.from({length:3},(_,i)=>({eventbrite_event_id:String(i),name:'Gathering '+i,start_date:'2026-09-25',primary_venue:{name:'Hall',address:{city:'Manchester',country:'GB'}}}));c.processSourceJobs();assert.deepEqual(sizes,[3]);assert.equal(tables.CityEvents.length,3);assert.equal(c.job_('eventbrite').offset,3);
});
test('Instagram posts batch triage after extraction and processed ledger is retained',()=>{
 const {c,props,tables}=harness();props.set('INSTAGRAM_RESEARCH_ACCOUNT','mcr');tables['Instagram Follows']=[{Handle:'venue','User ID':'1','Research account':'mcr','Follow status':'Active','Checked posts':'{}'}];const sizes=mockAI(c);c.extractInstagramEvents_=post=>[event({ID:'ig_'+post.id,Source:'instagram','Event Name':'Gathering '+post.id})];c.saveJob_('posts',{id:'fixture',phase:'RUNNING',offset:0,account:'mcr',end:'2026-10-01'});c.apify_=()=>({data:{status:'SUCCEEDED',defaultDatasetId:'fixture'}});c.datasetItems_=()=>[1,2,3].map(id=>({id:String(id),ownerUsername:'venue',timestamp:'2026-09-20T09:00:00Z'}));c.processSourceJobs();assert.deepEqual(sizes,[3]);assert.equal(tables.CityEvents.length,3);assert.equal(Object.keys(JSON.parse(tables['Instagram Follows'][0]['Checked posts'])).length,3);
});
test('existing OpenAI request uses configured model for triage',()=>{
 const {c,props,tables}=harness();props.set('OPENAI_API_KEY','fixture');vm.runInContext(code.slice(code.indexOf('function openAIJson_('),code.indexOf('// Compatibility for the original')),c);let model;c.fetchJson_=(_u,options)=>{model=JSON.parse(options.payload).model;return {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({decisions:[{index:0,decision:'uncertain',reason:'Insufficient evidence'}]})}]}]};};tables.CityEvents=[event({'Event Name':'Gathering'})];c.triageCityEvents_();assert.equal(model,'configured-fixture-model');
});
test('temporary AI failure retries automatically on the next assessment',()=>{
 const {c,tables}=harness();tables.CityEvents=[event({'Event Name':'Gathering'})];c.triageCityEvents_();assert.equal(tables.CityEvents[0].Include,false);const sizes=mockAI(c);c.triageCityEvents_();assert.deepEqual(sizes,[1]);assert.equal(tables.CityEvents[0].Include,true);
});
test('AI calls happen outside sheet locks and missing configuration never falls back',()=>{
 const {c,props,tables}=harness();let locked=false,calls=0;c.withLock_=fn=>{assert.equal(locked,false);locked=true;try{return fn();}finally{locked=false;}};
 c.openAIJson_=()=>{assert.equal(locked,false);calls++;return {decisions:[{index:0,decision:'reject',reason:'Ordinary performance.'}]};};
 tables.CityEvents=[event({'Event Name':'Gathering'})];props.delete('OPENAI_MODEL');c.triageCityEvents_();assert.equal(calls,0);props.set('OPENAI_MODEL','configured-fixture-model');c.triageCityEvents_();assert.equal(calls,1);
});
const opportunityCases=[
 ['Freshers fair','include'],
 ['Public university society fair','include'],
 ['Student society social','include'],
 ['Members-only student society event','reject'],
 ['Young professionals networking evening','include'],
 ['Community cultural festival','include'],
 ['Street-food market','include'],
 ['Community pottery workshop','include'],
 ['Public exhibition/open day','include'],
 ['Children’s festival','reject'],
 ['Online webinar','reject'],
 ['Premier League football match','reject'],
 ['Ordinary seated concert','reject'],
 ['Public music festival with concerts and social activities','include'],
 ['Nightclub party','reject'],
 ['Freshers nightclub party','reject'],
 ['Student rave','reject'],
 ['DJ club night','reject'],
 ['Afterparty','reject'],
 ['Running club','include'],
 ['Book club','include'],
 ['Community sports club open day','include'],
 ['Photography club meetup','include'],
 ['DJ workshop','include']
];
for(const [name,decision] of opportunityCases) test('opportunity criteria: '+name+' → '+decision,()=>{
 const {c,tables}=harness();let aiCalls=0;c.openAIJson_=()=>{aiCalls++;throw Error('Unexpected AI call for clear case')};
 tables.CityEvents=[event({'Event Name':name})];c.triageCityEvents_();assert.equal(aiCalls,0);assert.equal(tables.CityEvents[0].Include,decision==='include');assert.equal(tables.CityEvents[0].Triage,decision==='include'?'Auto included':'Auto rejected');
});
test('ambiguous event goes to OpenAI with opportunity-discovery instructions',()=>{
 const {c,tables}=harness();let calls=0;c.openAIJson_=(instructions,input)=>{
  calls++;assert.match(instructions,/plausible EV\/outreach opportunity/);assert.match(instructions,/Absence of explicit public, 18-30 or networking wording is not by itself grounds for rejection/);assert.match(instructions,/never invent supporting facts/);assert.match(instructions,/Nightclubs, club nights, parties, raves/);
  return {decisions:JSON.parse(input[0].content).map(x=>({index:x.index,decision:'include',reason:'Plausible opportunity from supplied facts.'}))};
 };tables.CityEvents=[event({'Event Name':'Manchester Connections'})];c.triageCityEvents_();assert.equal(calls,1);assert.equal(tables.CityEvents[0].Include,true);
});
test('bare context words are not automatic exclusions',()=>{
 const {c}=harness();for(const name of ['Club','DJ','Music','Football','Concert','University','Student'])assert.equal(c.triageRule_(event({'Event Name':name})),null,name);
});
test('participatory and nightlife/passive conflicts are assessed by AI',()=>{
 const {c}=harness();for(const name of ['Opera workshop','Orchestra open day','Football match networking meetup','Party planning workshop','Nightclub photography workshop'])assert.equal(c.triageRule_(event({'Event Name':name})),null,name);
 assert.equal(c.triageRule_(event({'Event Name':'DJ workshop',Category:'Nightlife'})),null);
});
test('nightlife variants remain excluded regardless of student/freshers labels',()=>{
 const {c}=harness();for(const name of ['Freshers party','Freshers rave','After parties','Party night','DJ club night at a nightclub','Student partying','Nightlife dancing'])assert.equal(c.triageRule_(event({'Event Name':name})).decision,'reject',name);
});
const religiousEvents=[
 'Manchester Single Muslim Get Together',
 'Young Muslim Marriage Event',
 'Muslim Marriage Events Mcr',
 'Islamic conference',
 'Hindu religious event',
 'Sikh religious event',
 'Buddhist religious event',
 'Jewish religious event',
 'Mosque open day',
 'Public Muslim young adults networking workshop',
 'Hindu community social',
 'Sikh community gathering',
 'Jewish singles meetup',
 'Networking for young Muslims'
];
for(const name of religiousEvents) test('explicit religious-event affiliation: '+name+' → exclude',()=>{
 const {c,tables}=harness();const calls=mockAI(c);tables.CityEvents=[event({'Event Name':name})];c.triageCityEvents_();
 assert.equal(tables.CityEvents[0].Include,false);assert.equal(tables.CityEvents[0].Triage,'Auto rejected');assert.match(tables.CityEvents[0]['Triage Reason'],/explicitly centres on a non-Christian religion/);assert.deepEqual(calls,[]);
});
test('explicit religious category overrides positive public/social signals',()=>{
 const {c,tables}=harness();tables.CityEvents=[event({'Event Name':'Public young adults networking workshop',Category:'Religion: Buddhism'})];c.triageCityEvents_();assert.equal(tables.CityEvents[0].Triage,'Auto rejected');
});
for(const name of ['Christian community event','Manchester cultural festival','Community workshop with Mohammed Ahmed','Indian street-food market','Pakistani community networking','Chinese community festival','Jewish cuisine workshop','Islamic art exhibition','History of the Jewish community']) test('no inferred religious affiliation: '+name,()=>{
 const {c,tables}=harness();const rule=c.triageRule_(event({'Event Name':name}));assert.notEqual(rule?.decision,'reject');mockAI(c);tables.CityEvents=[event({'Event Name':name})];c.triageCityEvents_();assert.equal(tables.CityEvents[0].Include,true);
});
test('venue and neighbourhood cannot establish religious affiliation',()=>{
 const {c}=harness();for(const [Venue,Area] of [['Mosque Hall','Rusholme'],['Synagogue Hall','Cheetham Hill'],['Hindu Centre','Manchester']])assert.equal(c.triageRule_(event({Venue,Area})).decision,'include');
});
test('ambiguous religious references use prompt prohibiting inference and factual changes',()=>{
 const {c,tables}=harness();let calls=0;c.openAIJson_=(instructions,input)=>{
  calls++;assert.match(instructions,/Christian evangelism opportunities/);assert.match(instructions,/explicitly organised around, targeted toward or primarily centred/);assert.match(instructions,/Never infer religion from a person’s name, ethnicity, nationality, cuisine, cultural background, venue, location or neighbourhood/);assert.match(instructions,/Christian events and events without explicit religious affiliation continue through normal suitability assessment/);
  return {decisions:JSON.parse(input[0].content).map(e=>({index:e.index,decision:'uncertain',reason:'Affiliation is unclear from supplied event facts.'}))};
 };const original=event({'Event Name':'Islamic art exhibition'});tables.CityEvents=[original];c.triageCityEvents_();assert.equal(calls,1);assert.equal(tables.CityEvents[0].Triage,'Auto uncertain');for(const k of ['ID','Event Name','Date','Time','Venue','Area','Category','URL'])assert.equal(tables.CityEvents[0][k],original[k]);
});
test('religious policy does not override owner decisions or explicit ignore protection',()=>{
 const {c,tables}=harness();const originals=[event({'Event Name':'Muslim marriage event',Include:true,Triage:'Owner selected'}),event({ID:'ignored','Event Name':'Hindu community workshop','Ignored (Y/N)':'Y'}),event({ID:'feedback','Event Name':'Sikh community event',Feedback:'Owner decision'})];tables.CityEvents=structuredClone(originals);c.triageCityEvents_();assert.deepEqual(tables.CityEvents,originals);
});
test('Ticketmaster automatic pipeline applies religious triage and does not call AI again',()=>{
 const {c,props,tables}=harness();props.set('TICKETMASTER_API_KEY','fixture');const sizes=mockAI(c);c.fetchJson_=()=>({page:{totalPages:1},_embedded:{events:['Community market','Muslim Marriage Events Mcr','Manchester Connections'].map((name,i)=>({id:String(i),name,dates:{start:{localDate:'2026-09-25'}},_embedded:{venues:[{name:'Hall',city:{name:'Manchester'}}]}}))}});
 c.refreshTicketmasterEvents();assert.deepEqual(tables.CityEvents.map(e=>e.Include),[true,false,true]);assert.deepEqual(sizes,[1]);c.refreshTicketmasterEvents();assert.deepEqual(sizes,[1]);assert.equal(tables.CityEvents.length,3);
});
test('Eventbrite automatic job applies religious triage and commits its cursor',()=>{
 const {c,tables}=harness();const sizes=mockAI(c);c.saveJob_('eventbrite',{id:'fixture',phase:'RUNNING',offset:0,start:'2026-09-20',end:'2026-10-01'});c.apify_=()=>({data:{status:'SUCCEEDED',defaultDatasetId:'fixture'}});c.datasetItems_=(_dataset,offset)=>offset?[]:['Community market','Jewish religious event','Manchester Connections'].map((name,i)=>({eventbrite_event_id:String(i),name,start_date:'2026-09-25',primary_venue:{name:'Hall',address:{city:'Manchester',country:'GB'}}}));
 c.processSourceJobs();assert.deepEqual(tables.CityEvents.map(e=>e.Include),[true,false,true]);assert.deepEqual(sizes,[1]);assert.equal(c.job_('eventbrite').offset,3);c.processSourceJobs();assert.deepEqual(sizes,[1]);assert.equal(c.job_('eventbrite').phase,'DONE');
});
test('Instagram automatic job applies religious triage after posts without re-extraction',()=>{
 const {c,props,tables}=harness();props.set('INSTAGRAM_RESEARCH_ACCOUNT','mcr');tables['Instagram Follows']=[{Handle:'venue','User ID':'1','Research account':'mcr','Follow status':'Active','Checked posts':'{}'}];const sizes=mockAI(c);let extractions=0;c.extractInstagramEvents_=post=>{extractions++;return [event({ID:'ig_'+post.id,Source:'instagram','Event Name':['Community market','Buddhist religious event','Manchester Connections'][Number(post.id)-1]})];};
 c.saveJob_('posts',{id:'fixture',phase:'RUNNING',offset:0,account:'mcr',end:'2026-10-01'});c.apify_=()=>({data:{status:'SUCCEEDED',defaultDatasetId:'fixture'}});c.datasetItems_=(_dataset,offset)=>offset?[]:[1,2,3].map(id=>({id:String(id),ownerUsername:'venue',timestamp:'2026-09-20T09:00:00Z'}));
 c.processSourceJobs();assert.deepEqual(tables.CityEvents.map(e=>e.Include),[true,false,true]);assert.deepEqual(sizes,[1]);c.processSourceJobs();assert.equal(extractions,3);assert.deepEqual(sizes,[1]);assert.equal(c.job_('posts').phase,'DONE');
});
test('running Apify jobs return without dataset import, triage, sleeps or queue work',()=>{
 const {c}=harness();let polls=0;c.saveJob_('eventbrite',{id:'fixture',phase:'RUNNING',offset:0});c.apify_=()=>{polls++;return {data:{status:'RUNNING'}}};
 c.datasetItems_=()=>{throw Error('Must not import a running job')};c.triageCityEvents_=()=>{throw Error('Must not triage a running job')};c.processQueues=()=>{throw Error('Source worker must not run Telegram queues')};
 c.processSourceJobs();assert.equal(polls,1);assert.equal(c.job_('eventbrite').phase,'RUNNING');
});
test('nightlife exclusion still applies when religion is merely mentioned',()=>{
 const {c}=harness();assert.equal(c.triageRule_(event({'Event Name':'Nightclub party near mosque'})).decision,'reject');
});
test('Christian events mentioning another faith are not deterministically excluded by affiliation',()=>{
 const {c}=harness();for(const name of ['Christian community event for Muslims','Christian workshop about Islam'])assert.equal(c.triageRule_(event({'Event Name':name})),null);
});
test('Apify refresh starts asynchronously and repeat refresh does not start a second job',()=>{
 const {c}=harness();let starts=0;c.apify_=(path)=>{assert.match(path,/waitForFinish=1/);starts++;return {data:{id:'fixture'}};};c.datasetItems_=()=>{throw Error('Refresh must not wait for a dataset')};c.triageCityEvents_=()=>{throw Error('Refresh must not triage before import')};
 c.refreshEventbriteEvents();c.refreshEventbriteEvents();assert.equal(starts,1);assert.equal(c.job_('eventbrite').phase,'RUNNING');
});
