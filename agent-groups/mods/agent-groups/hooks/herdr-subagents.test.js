// node herdr-subagents.test.js -> "herdr-subagents ok"
'use strict';
const assert = require('assert');
const { labelArgs } = require('./herdr-subagents.js');

assert.deepStrictEqual(labelArgs('start', { agent_id: 'a1', agent_type: 'cd:explorer' }), ['sub.a1=cd:explorer']);
assert.deepStrictEqual(labelArgs('start', { agent_id: 'a1', agent_type: 'bad type;rm' }), ['sub.a1=agent']);
assert.deepStrictEqual(labelArgs('stop', { agent_id: 'a1' }), ['sub.a1=']);
assert.deepStrictEqual(labelArgs('start', { agent_id: '../x' }), []);
assert.deepStrictEqual(labelArgs('start', null), []);
assert.deepStrictEqual(labelArgs('clear', null, { 'sub.a': 'x', 'sub.b': '', ticker: '{}' }), ['sub.a=', 'sub.b=']);
assert.deepStrictEqual(labelArgs('clear', null, undefined), []);
assert.deepStrictEqual(labelArgs('bogus', { agent_id: 'a1' }), []);
console.log('herdr-subagents ok');
