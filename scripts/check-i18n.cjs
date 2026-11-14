const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(new URL('../dist/i18n.js', `file://${__filename}`), 'utf8');
function load(languages, saved, blocked = false) {
  const writes = [];
  const context = vm.createContext({navigator:{languages},localStorage:{
    getItem(){if(blocked)throw Error('blocked');return saved;},
    setItem(...args){if(blocked)throw Error('blocked');writes.push(args);}
  }});
  vm.runInContext(source, context);
  return {i18n:vm.runInContext('I18n',context),writes};
}
for (const [languages,saved,locale] of [
  [['ru-RU','en-US'],null,'ru-RU'], [['en-GB','ru'],null,'en-US'],
  [['de-DE','ru'],null,'ru-RU'], [['de-DE'],null,'en-US'],
  [[],null,'en-US'], [['RU_ru'],null,'ru-RU'],
  [['en-US'],'ru','ru-RU'], [['ru'],'en','en-US'], [['ru'],'xx','ru-RU']
]) assert.equal(load(languages,saved).i18n.locale(),locale);
const {i18n,writes}=load(['en']);
assert.equal(i18n.t('Бекенды'),'Backends');
assert.equal(i18n.t('Custom backend'),'Custom backend');
assert.equal(i18n.t('Очередь 15.3 > 2.0 на узел'),'Queue 15.3 > 2.0 per node');
assert.equal(i18n.t('api: Кворум должен быть между 1 и числом дочерних вызовов'),'api: Quorum must be between 1 and the number of child calls');
assert.equal(i18n.template(['Настройки ',''],'api-1'),'Settings for api-1');
// Interpolated user values are not parsed as translation placeholders.
assert.equal(i18n.template(['Настройки ',''],'{{1}}'),'Settings for {{1}}');
let changes=0;i18n.onChange(()=>changes++);i18n.setLanguage('ru');
assert.equal(changes,1);assert.equal(writes[0][1],'ru');assert.equal(i18n.t('Бекенды'),'Бекенды');
const blocked=load(['en'],null,true).i18n;blocked.setLanguage('ru');assert.equal(blocked.locale(),'ru-RU');
console.log('Language detection, preference, storage fallback, templates and engine messages: OK');

// Model labels never pass through the interface dictionary.
const model=load(['en']).i18n;
assert.equal(model.name({name:'Бекенды'}),'Бекенды');
assert.equal(model.name({name:'Disk'}),'Disk');
const named={name:'Database',i18n:{ru:{name:'Хранилище'},'fr-CA':{name:'Stockage Canada'},fr:{name:'Stockage'}}};
assert.equal(model.name(named,'ru-RU'),'Хранилище');
assert.equal(model.name(named,'fr-CA'),'Stockage Canada');
assert.equal(model.name(named,'fr-FR'),'Stockage');
assert.equal(model.name(named,'de'),'Database');
assert.equal(model.name({name:'Fallback',i18n:{ru:{name:''}}},'ru'),'Fallback');
assert.equal(model.name({name:'Fallback',i18n:{en:{name:'English'}}},'de'),'English');
assert.equal(model.name({name:'Disk',i18n:{RU:{name:'Диск автора'}}},'ru'),'Диск автора');
const serialized=JSON.stringify(named);model.name(named,'ru');assert.equal(JSON.stringify(named),serialized);
const french=load(['fr-CA','en']).i18n;
french.setModelLanguages({groups:[{resources:[named]}]});assert.equal(french.locale(),'fr-CA');
assert.equal(french.t('Запросы'),'Requests');assert.equal(french.name(named),'Stockage Canada');
french.setLanguage('ru');assert.equal(french.name(named),'Хранилище');
french.setModelLanguages({});assert.equal(french.locale(),'ru-RU');
const german=load(['de'],'de').i18n;german.setModelLanguages({i18n:{de:{name:'Modell'}}});assert.equal(german.locale(),'de');
german.setModelLanguages({});assert.equal(german.locale(),'en-US');
console.log('Model labels: explicit translations, fallback, regional tags, language selection and unchanged input: OK');

assert.equal(model.description({name:'Not a description'}),'');
assert.equal(model.description({description:'Base',i18n:{ru:{description:'Описание'}}},'ru-RU'),'Описание');
assert.equal(model.description({description:'Base',i18n:{ru:{name:'Name only'}}},'ru'),'Base');

// English source messages translate to Russian, including parameters and prefixes.
const sourceLabels=load(['en']).i18n;
assert.equal(sourceLabels.t('Queue 15.3 > 2.0 per node'),'Queue 15.3 > 2.0 per node');
sourceLabels.setLanguage('ru');
assert.equal(sourceLabels.t('Queue 15.3 > 2.0 per node'),'Очередь 15.3 > 2.0 на узел');
assert.equal(sourceLabels.t('Utilization 25.0% ≤ 30.0%, queues are empty'),'Занятость 25.0% ≤ 30.0%, очереди пусты');
assert.equal(sourceLabels.t('api: Quorum must be between 1 and the number of child calls'),'api: Кворум должен быть между 1 и числом дочерних вызовов');
assert.equal(sourceLabels.template(['Settings for ',''],'{{1}}'),'Настройки {{1}}');
assert.equal(sourceLabels.t(' Request labels '),' Метки запросов ');
sourceLabels.setLanguage('en');
assert.equal(sourceLabels.template(['Settings for ',''],'api-1'),'Settings for api-1');

// Static DOM discovery must recognize English source text and restore it on switch.
const textNode={nodeValue:'  Loading engine… ',isConnected:true,parentElement:{closest:()=>null}};
const userNode={nodeValue:'Custom backend',isConnected:true,parentElement:{closest:()=>null}};
const excludedNode={nodeValue:'Loading engine…',isConnected:true,parentElement:{closest:()=>({})}};
const attributes={title:'Pause or resume'};
const element={isConnected:true,getAttribute:name=>attributes[name],setAttribute:(name,value)=>attributes[name]=value};
let languageChange;
const selector={value:'',addEventListener:(name,fn)=>languageChange=fn};
const document={
  documentElement:{lang:'en'},
  createTreeWalker(){const nodes=[textNode,userNode,excludedNode];return {nextNode:()=>nodes.shift()};},
  querySelectorAll:()=>[element],
  getElementById:()=>selector
};
const dom=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},navigator:{languages:['en']}});
vm.runInContext(source,dom);
assert.equal(textNode.nodeValue,'  Loading engine… ');
assert.equal(document.documentElement.lang,'en');
languageChange({target:{value:'ru'}});
assert.equal(textNode.nodeValue,'  Загрузка ядра… ');
assert.equal(attributes.title,'Пауза или продолжение');
assert.equal(userNode.nodeValue,'Custom backend');
assert.equal(excludedNode.nodeValue,'Loading engine…');
languageChange({target:{value:'en'}});
assert.equal(textNode.nodeValue,'  Loading engine… ');
assert.equal(attributes.title,'Pause or resume');
assert.equal(document.documentElement.lang,'en');
console.log('English source messages and static DOM language switching: OK');
