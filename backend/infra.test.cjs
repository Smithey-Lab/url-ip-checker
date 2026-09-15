const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
test('standalone infrastructure keeps quotas scoped and deployment disabled',()=>{
  execFileSync(process.execPath,['scripts/build-infra.mjs']);
  const template=JSON.parse(readFileSync('infra/checker-cloudformation.json','utf8'));
  assert.equal(template.Parameters.Enabled.Default,'false');
  assert.deepEqual(template.Resources.Stage.DependsOn,['Route']);
  const statements=template.Resources.Role.Properties.Policies[0].PolicyDocument.Statement;
  assert.equal(statements.length,1);
  assert.equal(statements[0].Action,'dynamodb:UpdateItem');
  assert.deepEqual(statements[0].Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['checker:*']);
});
