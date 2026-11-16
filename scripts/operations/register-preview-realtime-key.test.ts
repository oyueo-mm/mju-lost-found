import {execFileSync,spawnSync} from "node:child_process";
import {existsSync,statSync} from "node:fs";
import {expect,it} from "vitest";
const env={...process.env};delete env.SUPABASE_ACCESS_TOKEN;
const script="scripts/operations/register-preview-realtime-key.mjs";
it("dry run creates no key/checkpoint and reports only non-secret readiness",()=>{
  const file=".vercel/realtime-preview-registration.dpapi",before=existsSync(file)?statSync(file).mtimeMs:null;
  const output=JSON.parse(execFileSync(process.execPath,[script],{env,encoding:"utf8"}));
  expect(output).toMatchObject({target:"preview",apply:false,managementAuthenticated:false});
  expect(existsSync(file)?statSync(file).mtimeMs:null).toBe(before);
});
it("rejects Production arguments and refuses registration without management authentication",()=>{
  for(const args of [["--apply","--confirm-production"],["--apply","--confirm-preview-only"]]){
    const r=spawnSync(process.execPath,[script,...args],{env,encoding:"utf8"});expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Preview|Authenticated Supabase/);
  }
});
