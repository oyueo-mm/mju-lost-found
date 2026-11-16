export const D3_MIGRATIONS=["20261123000000_chat_realtime_grants","20261123010000_chat_realtime_policy","20261123020000_chat_realtime_revocation","20261123030000_chat_realtime_enum_labels","20261123040000_chat_realtime_external_identity","20261123050000_chat_realtime_row_topic"];
export function checkD3Migrations(checksums,history,historical={}){
  const applied=new Set();
  for(const row of history){
    if(row.rolled_back)continue;
    if(!row.applied)throw new Error("Unfinished migration exists");
    const expected=checksums[row.migration_name]??historical[row.migration_name];
    if(!expected?.includes(row.checksum))throw new Error("Unrecognized migration or checksum");
    applied.add(row.migration_name);
  }
  const pending=Object.keys(checksums).filter(k=>!applied.has(k)).sort();
  if(pending.some(k=>!D3_MIGRATIONS.includes(k)))throw new Error("Only D3 migrations may be pending");
  return pending;
}
