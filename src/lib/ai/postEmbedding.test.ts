import { beforeEach, expect, it, vi } from "vitest";
const runImageJob=vi.fn(), saveImageEmbedding=vi.fn(), saveEmbedding=vi.fn(), embed=vi.fn();
vi.mock("./imageJob",()=>({runImageJob}));
vi.mock("./vectorSearch",()=>({saveEmbedding,saveImageEmbedding}));
vi.mock("./embedding",()=>({buildEmbeddingText:()=>"current text",getEmbeddingProvider:()=>({embed})}));
const {embedPostImageBestEffort,embedPostBestEffort}=await import("./postEmbedding");
beforeEach(()=>{vi.clearAllMocks();runImageJob.mockResolvedValue({status:"completed"});});
it("keeps older tools inside the shared budget and lease controller",async()=>{
  runImageJob.mockResolvedValueOnce({status:"limited"});
  await embedPostImageBestEffort("lost",7,"https://untrusted.invalid/stale.jpg");
  expect(runImageJob).toHaveBeenCalledWith("lost",7);
  expect(saveImageEmbedding).not.toHaveBeenCalled();expect(embed).not.toHaveBeenCalled();
});
it("preserves best-effort behavior during a paused transition",async()=>{
  runImageJob.mockResolvedValueOnce({status:"pending"});
  await expect(embedPostImageBestEffort("found",8,"old-url")).resolves.toBeUndefined();
  expect(saveImageEmbedding).not.toHaveBeenCalled();
});
it("preserves text embedding and its stored vector",async()=>{
  embed.mockResolvedValueOnce([1,2,3]);
  await embedPostBestEffort("lost",7,{title:"text"});
  expect(saveEmbedding).toHaveBeenCalledWith("lost",7,[1,2,3]);
  expect(runImageJob).not.toHaveBeenCalled();
});
