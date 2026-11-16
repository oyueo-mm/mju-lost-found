import {describe,it,expect} from "vitest";
import {checkD3Migrations,D3_MIGRATIONS} from "./release-d3-policy.mjs";
describe("D3 migration boundary",()=>{
  const checksums={baseline:["base"],...Object.fromEntries(D3_MIGRATIONS.map(n=>[n,["new"]]))};
  const base={migration_name:"baseline",checksum:"base",applied:true,rolled_back:false};
  it("permits only the six additive D3 migrations",()=>expect(checkD3Migrations(checksums,[base])).toEqual(D3_MIGRATIONS));
  it("refuses missing baseline, checksum drift, unfinished and unrelated migrations",()=>{
    expect(()=>checkD3Migrations(checksums,[])).toThrow();
    expect(()=>checkD3Migrations(checksums,[{...base,checksum:"different"}])).toThrow();
    expect(()=>checkD3Migrations(checksums,[{...base,applied:false}])).toThrow();
    expect(()=>checkD3Migrations({...checksums,other:["sql"]},[base])).toThrow();
  });
  it("preserves rolled-back failure history and strictly verifies documented legacy history",()=>{
    const failed={migration_name:D3_MIGRATIONS[0],checksum:"original-failure",applied:false,rolled_back:true};
    const legacy={migration_name:"documented-preview",checksum:"known",applied:true,rolled_back:false};
    expect(checkD3Migrations(checksums,[base,failed,legacy],{"documented-preview":["known"]})).toEqual(D3_MIGRATIONS);
    expect(()=>checkD3Migrations(checksums,[base,{...legacy,checksum:"changed"}],{"documented-preview":["known"]})).toThrow();
  });
});
