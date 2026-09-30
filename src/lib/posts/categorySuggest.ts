import {
  isSubcategoryCode,
  parentCategoryOf,
  type CategoryCode,
  type SubcategoryCode,
} from "./categoryTaxonomy";

// Keyword-based category suggestion from a post's title/description, for
// pre-selecting chips in the UI only. The result is a hint the author
// confirms or changes -- never save it without the author's choice, and
// never overwrite a category/subcategory someone already picked.
//
// A rule target is either a full subcategory code or, for a generic word
// that names the category but not the kind ("가방 하나", "카드 한 장"), a
// bare category code -- which suggests the category with subcategory null
// (unclassified), not "<category>.other".
type RuleTarget = CategoryCode | SubcategoryCode;

// Ordered: the first match wins. Specific item words come before generic
// ones, and the object itself before what's attached to or inside it.
// Classification policy encoded here:
//   - a phone-only case -> electronics.phone
//   - AirPods/earphone cases, covers, ear tips -> electronics.earphones
//   - student-ID cases, lanyard card cases, card holders -> wallet.card_case;
//     card wallets / MagSafe card pockets -> wallet.card_wallet
//   - laptop/cosmetic pouches -> bag.pouch
//   - keys with a keyring attached -> living.key
//   - photo cards, game cards, ... are never card_id (living.hobby)
const RULES: ReadonlyArray<readonly [RegExp, RuleTarget]> = [
  // Card-looking things that are not payment/ID cards.
  [/포토\s?카드|우노\s?카드|트레이딩\s?카드|게임\s?카드|카드\s?게임|보드\s?게임|타로\s?카드/, "living.hobby"],
  // Things that hold cards are wallets, whatever card is inside. A 지갑/포켓
  // is a card wallet; a 케이스/홀더 (student-ID case, lanyard case) a card case.
  // Lanyard card holders are card cases even when called 지갑 (policy: 목걸이 카드케이스).
  [/목걸이\s?카드|(학생증|신분증)\s?(케이스|홀더)|패스\s?케이스/, "wallet.card_case"],
  [/카드\s?지갑|명함\s?지갑|카드\s?포켓|맥세이프\s?카드/, "wallet.card_wallet"],
  [/카드\s?(케이스|홀더)/, "wallet.card_case"],
  [/학생증/, "card_id.student_id"],
  [/신분증|교직원증|주민등록증|운전\s?면허증|외국인\s?등록증|여권/, "card_id.id_card"],
  [/교통\s?카드|티머니|t-?money|캐시비/i, "card_id.transit_card"],
  [/신용\s?카드/, "card_id.credit_card"],
  [/체크\s?카드|직불\s?카드/, "card_id.debit_card"],
  [/회원\s?카드|멤버십\s?카드|도서관\s?카드|스탬프\s?카드/, "card_id.other"],
  // "지갑은 있는데 카드만 빠졌어요": the lost item is the card.
  [/카드만|은행\s?카드/, "card_id"],
  [/장지갑/, "wallet.long_wallet"],
  [/반지갑|머니\s?클립/, "wallet.bifold"],
  [/지갑/, "wallet"],

  // Electronics. Chargers/cables/power banks before laptops ("맥북 충전기"),
  // laptop pouches before laptops, stylus pens before phones ("갤럭시 S펜").
  [/보조\s?배터리|배터리\s?팩|배터리/, "electronics.power_bank"],
  [/케이블|젠더|랜선|충전\s?선/, "electronics.cable"],
  [/충전기|어댑터|충전\s?(패드|독)/, "electronics.charger"],
  [/에어팟\s?맥스|헤드폰|헤드셋/, "electronics.headphones"],
  [/에어팟|airpods?|버즈|이어폰|이어팁|이어버드/i, "electronics.earphones"],
  [/(노트북|태블릿|아이패드)\s?(파우치|슬리브)/, "bag.pouch"],
  // A tablet with its pen is the tablet ("아이패드 + 애플펜슬").
  [/태블릿|아이패드|ipad|갤럭시\s?탭/i, "electronics.tablet"],
  [/애플\s?펜슬|S\s?펜|스타일러스|마우스|키보드|허브|거치대/i, "electronics.peripheral"],
  [/usb|외장\s?(하드|ssd)|ssd|sd\s?카드|메모리\s?카드/i, "electronics.storage"],
  [/노트북|맥북|macbook|갤럭시\s?북|lg\s?그램/i, "electronics.laptop"],
  [/폰\s?케이스|휴대폰|핸드폰|스마트폰|아이폰|iphone|갤럭시\s?(s\s?\d|a\s?\d|노트\s?\d|z|폴드|플립)|폴더블/i, "electronics.phone"],
  [/워치|스피커|카메라|손\s?선풍기|가습기|고데기|드라이기|전자\s?사전|게임기|닌텐도|멀티탭/, "electronics.other"],

  // A keyring attached to keys is still keys; a bare 열쇠고리 is a keyring.
  [/열쇠(?!\s?고리)|자동차\s?키|차\s?키|스마트\s?키|도어\s?키|카드\s?키/, "living.key"],

  // Accessories. Glasses cloths/lens cases are not glasses.
  [/안경\s?닦이|안경\s?천|렌즈\s?케이스/, "living.other"],
  [/선글라스/, "accessory.sunglasses"],
  [/안경|뿔테/, "accessory.glasses"],
  [/시계/, "accessory.watch"],
  [/반지|목걸이|귀걸이|팔찌|피어싱|브로치/, "accessory.jewelry"],
  [/집게\s?핀|머리\s?끈|헤어\s?(핀|밴드|클립|끈)|곱창\s?밴드|머리띠|실핀/, "accessory.hair"],
  [/키링|키\s?홀더|열쇠\s?고리/, "accessory.keyring"],
  [/인형|뱃지|배지|그립톡/, "accessory.charm"],

  [/양산/, "living.parasol"],
  [/우산/, "living.umbrella"],
  [/텀블러|보온병/, "living.tumbler"],
  [/물병|물통|날진|보틀/, "living.water_bottle"],

  // Bags. Before books ("책가방").
  [/파우치|화장품\s?(가방|주머니)/, "bag.pouch"],
  [/백팩|배낭|책가방|잔스포츠/, "bag.backpack"],
  [/에코\s?백|천\s?가방|캔버스\s?백/, "bag.eco_bag"],
  [/토트/, "bag.tote"],
  [/쇼핑\s?백|종이\s?가방/, "bag.shopping_bag"],
  [/도시락\s?가방|보냉\s?백|크로스\s?백|숄더\s?백|메신저\s?백|슬링\s?백|힙\s?색/, "bag.other"],
  [/가방/, "bag"],

  // Stationery. Pencil cases before pens; 샤프 before 펜 ("샤프펜").
  [/필통|펜\s?케이스/, "stationery.pencil_case"],
  [/계산기/, "stationery.calculator"],
  [/샤프/, "stationery.mechanical_pencil"],
  [/볼펜|만년필|형광펜|사인펜|네임펜|펜/, "stationery.pen"],
  [/연필|지우개|수정\s?테이프|포스트잇|스테이플러/, "stationery.other"],

  // Books & documents. Notebooks before books; "노트북" matched above. A
  // file/folder is the object even when it holds documents ("서류 든 L자 파일").
  [/수첩|다이어리|플래너/, "book_document.planner"],
  [/노트/, "book_document.notebook"],
  [/전공\s?(서적|책)|원론|개론|자료구조|알고리즘|미적분/, "book_document.major_book"],
  [/교재|문제집|교과서|토익|토플|수험서/, "book_document.textbook"],
  [/소설|에세이|시집|만화책|잡지|동화책/, "book_document.general_book"],
  [/파일|클리어\s?화일/, "book_document.file"],
  [/서류|악보|문서|유인물/, "book_document.document"],
  [/책(?!상)/, "book_document"],

  // Clothing.
  [/모자|볼\s?캡|비니|버킷\s?햇/, "clothing.hat"],
  [/목도리|머플러|넥\s?워머|스카프/, "clothing.scarf"],
  [/장갑/, "clothing.gloves"],
  [/신발|운동화|슬리퍼|구두|샌들|크록스|스니커즈|실내화|부츠/, "clothing.shoes"],
  [/바지|청바지|치마|스커트|슬랙스|레깅스/, "clothing.bottom"],
  [/패딩|코트|자켓|재킷|점퍼|과잠|바람막이|가디건|집업|아우터/, "clothing.outer"],
  [/후드|맨투맨|셔츠|니트|상의|조끼|체육복/, "clothing.top"],
  [/양말|잠옷/, "clothing.other"],
  [/옷/, "clothing"],

  // Everyday items.
  [/줄넘기|글러브|라켓|손목\s?보호대|요가\s?매트|농구공|축구공|배구공|야구공|테니스공|셔틀콕/, "living.sports"],
  [/악기|기타\s?피크|퍼즐|레고/, "living.hobby"],
  [/목베개|담요|립밤|도장|손거울|핸드크림|자물쇠/, "living.other"],

  // A bare "카드" ("카드 한 장") is last, so "SD카드" / "카드키" win above.
  [/카드/, "card_id"],
];

export type CategorySuggestion = {
  category: CategoryCode;
  // null when only the category is clear (e.g. "가방 하나").
  subcategory: SubcategoryCode | null;
  // "title" matches are the stronger hint; a "description" match is weaker
  // (the description often mentions other things than the item itself).
  source: "title" | "description";
};

function match(text: string): RuleTarget | null {
  for (const [pattern, target] of RULES) {
    if (pattern.test(text)) return target;
  }
  return null;
}

// First rule naming a subcategory of `category` -- other rules are skipped,
// so a description's side details ("뱃지가 달린 배낭") can't hide the kind.
function matchSubcategoryWithin(text: string, category: CategoryCode): SubcategoryCode | null {
  for (const [pattern, target] of RULES) {
    if (isSubcategoryCode(target) && parentCategoryOf(target) === category && pattern.test(text)) return target;
  }
  return null;
}

function toSuggestion(target: RuleTarget, source: CategorySuggestion["source"]): CategorySuggestion {
  return isSubcategoryCode(target)
    ? { category: parentCategoryOf(target), subcategory: target, source }
    : { category: target, subcategory: null, source };
}

// Returns null when nothing matched -- the UI should then leave the
// selection empty rather than guess "기타".
export function suggestCategory(input: { title?: string | null; description?: string | null }): CategorySuggestion | null {
  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const fromTitle = title ? match(title) : null;
  if (fromTitle) {
    const titleSuggestion = toSuggestion(fromTitle, "title");
    // A generic title ("카드 한 장") keeps its category, but the description
    // may name the kind ("티머니 로고만 있는 흰 카드") -- only a kind within
    // that same category is taken from it.
    if (titleSuggestion.subcategory === null && description) {
      const subcategory = matchSubcategoryWithin(description, titleSuggestion.category);
      if (subcategory) return { category: titleSuggestion.category, subcategory, source: "description" };
    }
    return titleSuggestion;
  }
  const fromDescription = description ? match(description) : null;
  return fromDescription ? toSuggestion(fromDescription, "description") : null;
}

// Exposed for tests: every rule target must be a valid taxonomy code.
export const SUGGESTION_RULE_TARGETS: readonly RuleTarget[] = RULES.map(([, target]) => target);
