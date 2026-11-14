import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync('public/schema.json', 'utf8'));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const presets = JSON.parse(execFileSync('go', ['run', './cmd/schema', '-fixtures'], { encoding: 'utf8' }));
const skill = readFileSync('public/skill.md', 'utf8');
const example = JSON.parse(skill.match(/```json\s*([\s\S]*?)```/)[1]);
assert.ok(skill.includes(schema.$id), 'Public skill must link to the published schema');

function check(model, expected, name) {
  assert.equal(validate(model), expected, `${name}: ${JSON.stringify(validate.errors)}`);
}
for (const [name, model] of Object.entries({ ...presets, example })) check(model, true, name);

const valid = structuredClone(example);
valid.groups[0].cost = { enabled: true, source: 'caller', key: 'az', match: 1, mismatch: 3 };
valid.groups[0].keepalive = false;
valid.groups[0].keepaliveTimeout = 0;
valid.groups[0].retryConnect = null;
valid.groups[0].resources = [{
  id: 'outer', name: 'Outer', scope: 'instance', workers: 1, service: 0, queueLimit: 0, stages: [],
  resources: [{ id: 'inner', name: 'Inner', scope: 'instance', workers: 1, service: 0, queueLimit: 0, stages: [] }],
}];
valid.i18n = { ru: { name: 'Модель' } };
valid.overrides = { 'api-1': { workers: 2 } };
check(valid, true, 'recursive resources, embedded rule, maps, zero, false and null pointer');

for (const [name, edit] of Object.entries({
  'unknown root field': m => { m.unrecognized = true; },
  'unknown group field': m => { m.groups[0].edges = []; },
  'unknown nested field': m => { m.groups[0].resources[0].resources[0].extra = 1; },
  'unknown embedded field': m => { m.groups[0].cost.extra = 1; },
  'missing embedded field': m => { delete m.groups[0].cost.key; },
  'unknown translation field': m => { m.i18n.ru.extra = 1; },
  'invalid map value': m => { m.overrides['api-1'].workers = 'two'; },
  'missing stages': m => { delete m.groups[0].stages; },
  'null stages': m => { m.groups[0].stages = null; },
  'fractional count': m => { m.groups[0].count = 1.5; },
  'string number': m => { m.rps = '30'; },
  'negative unsigned seed': m => { m.seed = -1; },
  'invalid pointer': m => { m.groups[0].keepalive = 1; },
})) {
  const model = structuredClone(valid);
  edit(model);
  check(model, false, name);
}
console.log('JSON Schema: presets, public example and structural regressions passed');
