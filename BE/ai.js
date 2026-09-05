/**
 * ai/embedding.py + ai/matching.py + ai/search.py 의 포팅.
 *
 * 파이썬 원본은 sentence-transformers 로 한국어 모델(jhgan/ko-sroberta-multitask,
 * 약 440MB)을 받아 문장 임베딩을 만들었다. Node/Railway 환경에서 그 모델을
 * 그대로 쓰면 (1) 첫 요청 때 수백 MB 다운로드, (2) 무료 플랜 메모리 초과,
 * (3) 빌드 시간 급증 이라는 세 가지 문제가 생기므로, 기본 백엔드를 바꿨다.
 *
 *   local        (기본값) 문자 n-gram + 단어 TF-IDF 코사인 유사도. 순수 JS,
 *                다운로드 0, 첫 요청부터 즉시 동작. 한국어 조사/띄어쓰기
 *                변형에 강하도록 2글자 n-gram 을 함께 쓴다.
 *   transformers (선택)   @xenova/transformers 를 직접 설치했을 때만 사용.
 *                진짜 문장 임베딩이 필요하면 README 의 안내대로 켜면 된다.
 *
 * 백엔드 교체 지점은 embedTexts() 하나로 격리돼 있다 -- 원본 ai/embedding.py 가
 * "모델 선택을 이 파일 한 곳에 가둔다"고 했던 설계를 그대로 유지한 것이다.
 * 랭킹 로직(rankSimilarPosts / searchSimilarPosts)은 백엔드가 뭐든 그대로다.
 */

export const DEFAULT_TOP_K = 3;
export const SEARCH_TOP_K = 10;

const BACKEND = process.env.EMBEDDING_BACKEND || 'local';

/** 게시물의 검색 대상 필드들을 하나의 텍스트로 합친다 (원본 build_embedding_text). */
export function buildEmbeddingText(post) {
  return ['title', 'description', 'category', 'location']
    .map((field) => post?.[field])
    .filter(Boolean)
    .map(String)
    .join(' ');
}

// ------------------------------------------------------------ local backend

/**
 * 한국어에 맞춘 토크나이저.
 * 단어 자체 + 그 단어의 2글자 연속(n-gram)을 모두 토큰으로 쓴다.
 * "에어팟을" 과 "에어팟" 이 '에어','어팟' 이라는 공통 n-gram 을 갖게 되므로,
 * 형태소 분석기 없이도 조사 차이를 상당 부분 흡수한다.
 */
function tokenize(text) {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ\s]/g, ' ');
  const tokens = [];
  for (const word of cleaned.split(/\s+/)) {
    if (!word) continue;
    tokens.push(word);
    for (let i = 0; i < word.length - 1; i += 1) tokens.push(word.slice(i, i + 2));
  }
  return tokens;
}

function termFrequency(text) {
  const tf = new Map();
  for (const token of tokenize(text)) tf.set(token, (tf.get(token) || 0) + 1);
  return tf;
}

/**
 * 말뭉치(질의 + 후보 전체) 기준 IDF 로 가중치를 준 희소 벡터를 만든다.
 * 흔한 토큰("가방", "학교")의 영향력을 낮추고 변별력 있는 토큰을 살리는 역할로,
 * 임베딩 모델의 의미 벡터를 대체하는 건 아니지만 같은 목적(관련도 순위)에 쓰인다.
 */
function buildTfIdfVectors(texts) {
  const tfs = texts.map(termFrequency);
  const docFreq = new Map();
  for (const tf of tfs) {
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }
  const n = texts.length;
  return tfs.map((tf) => {
    const vec = new Map();
    for (const [term, count] of tf) {
      const idf = Math.log((n + 1) / ((docFreq.get(term) || 0) + 1)) + 1;
      vec.set(term, (1 + Math.log(count)) * idf);
    }
    return vec;
  });
}

/** 희소 벡터(Map) 두 개의 코사인 유사도. 0 벡터면 0.0 (0으로 나누지 않는다). */
function sparseCosine(a, b) {
  let dot = 0;
  // 항목 수가 적은 쪽을 순회해야 큰 문서와 짧은 질의를 비교할 때 훨씬 빠르다.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += weight * other;
  }
  if (dot === 0) return 0;
  let normA = 0;
  let normB = 0;
  for (const w of a.values()) normA += w * w;
  for (const w of b.values()) normB += w * w;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ------------------------------------------------- transformers backend (선택)

let transformerPipe = null;
let transformerFailed = false;

/**
 * @xenova/transformers 가 설치돼 있을 때만 진짜 문장 임베딩을 쓴다.
 * 한 번 실패하면 다시 시도하지 않고(네트워크 호출 반복 방지) local 로 떨어진다
 * -- 원본 embedding.py 가 _load_error 를 캐시하던 것과 같은 정책이다.
 */
async function getTransformerPipe() {
  if (transformerPipe) return transformerPipe;
  if (transformerFailed) return null;
  try {
    const { pipeline } = await import('@xenova/transformers');
    transformerPipe = await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
    );
    return transformerPipe;
  } catch (e) {
    transformerFailed = true;
    console.warn('[ai] transformers 백엔드를 쓸 수 없어 local 로 대체합니다:', e.message);
    return null;
  }
}

async function embedWithTransformers(texts) {
  const pipe = await getTransformerPipe();
  if (!pipe) return null;
  const output = await pipe(texts, { pooling: 'mean', normalize: true });
  const [rows, dim] = output.dims;
  const vectors = [];
  for (let i = 0; i < rows; i += 1) {
    vectors.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

function denseCosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ------------------------------------------------------------ ranking (공통)

/**
 * 첫 번째 텍스트를 기준으로 나머지 텍스트들의 유사도를 계산한다.
 * 백엔드가 무엇이든 반환 형태는 같다: [0..1] 범위의 점수 배열.
 */
async function scoreAgainstFirst(texts) {
  if (BACKEND === 'transformers') {
    const vectors = await embedWithTransformers(texts);
    if (vectors) {
      const [target, ...rest] = vectors;
      return rest.map((v) => denseCosine(target, v));
    }
    // 실패 시 아래 local 경로로 자연스럽게 떨어진다.
  }
  const vectors = buildTfIdfVectors(texts);
  const [target, ...rest] = vectors;
  return rest.map((v) => sparseCosine(target, v));
}

/**
 * 후보 게시물들을 target(게시물 또는 자유 문장)과의 의미 유사도 내림차순으로 정렬.
 * 반환: [{ post, score }] -- 원본의 MatchCandidate 와 같은 모양.
 */
async function rank(targetText, candidatePosts, topK) {
  if (!candidatePosts.length) return [];
  const texts = [targetText, ...candidatePosts.map(buildEmbeddingText)];
  const scores = await scoreAgainstFirst(texts);
  return candidatePosts
    .map((post, i) => ({ post, score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** 게시물 <-> 게시물. 원본 rank_similar_posts / find_similar_*_posts. */
export function rankSimilarPosts(targetPost, candidatePosts, topK = DEFAULT_TOP_K) {
  return rank(buildEmbeddingText(targetPost), candidatePosts, topK);
}

/**
 * 자유 문장 질의 <-> 게시물들. 원본 ai/search.py 의 search_similar_posts.
 * 질의가 공백뿐이거나 후보가 없으면 백엔드를 건드리지 않고 즉시 [] 를 돌려준다.
 */
export function searchSimilarPosts(query, posts, topK = SEARCH_TOP_K) {
  const q = String(query || '').trim();
  if (!q || !posts.length) return Promise.resolve([]);
  return rank(q, posts, topK);
}
