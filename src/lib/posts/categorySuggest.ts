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
//   - student-ID cases, lanyard card cases, MagSafe card pockets -> wallet.card_wallet
//   - laptop/cosmetic pouches -> bag.pouch
//   - keys with a keyring attached -> living.key
//   - photo cards, game cards, ... are never card_id
const RULES: ReadonlyArray<readonly [RegExp, RuleTarget]> = [
  // Card-looking things that are not payment/ID cards.
  [/포토\s?카드|우노\s?카드|트레이딩\s?카드|게임\s?카드|카드\s?게임|보드\s?게임|타로\s?카드/, "living.hobby_sports"],
  // Things that hold cards are wallets, whatever card is inside.
  [/카드\s?(케이스|지갑|홀더|포켓)|(학생증|신분증)\s?(케이스|홀더)|명함\s?지갑|목걸이\s?카드|패스\s?케이스/, "wallet.card_wallet"],
  [/학생증|신분증|주민등록증|운전\s?면허증|교직원증|외국인\s?등록증|여권/, "card_id.student_id"],
  [/교통\s?카드|티머니|t-?money|캐시비/i, "card_id.transit_card"],
  [/체크\s?카드|신용\s?카드|은행\s?카드|직불\s?카드/, "card_id.payment_card"],
  [/회원\s?카드|멤버십\s?카드|도서관\s?카드|스탬프\s?카드/, "card_id.other"],
  // "지갑은 있는데 카드만 빠졌어요": the lost item is the card.
  [/카드만/, "card_id"],
  [/반지갑|장지갑|머니\s?클립/, "wallet.bifold_long"],
  [/지갑/, "wallet"],

  // Electronics. Chargers before laptops ("맥북 충전기"), laptop pouches
  // before laptops, stylus pens before phones ("갤럭시 S펜").
  [/충전기|어댑터|배터리|케이블|랜선|젠더|충전\s?(선|패드|독)|멀티탭/, "electronics.charger_cable_battery"],
  [/에어팟|airpods?|버즈|이어폰|헤드폰|헤드셋|이어팁|이어버드/i, "electronics.earphones"],
  [/(노트북|태블릿|아이패드)\s?(파우치|슬리브)/, "bag.pouch"],
  [/애플\s?펜슬|S\s?펜|스타일러스|마우스|키보드|usb|외장\s?(하드|ssd)|sd\s?카드|메모리\s?카드|허브|거치대/i, "electronics.peripheral_storage"],
  [/노트북|맥북|macbook|갤럭시\s?북|그램\s?노트북|lg\s?그램|태블릿|아이패드|ipad|갤럭시\s?탭/i, "electronics.laptop_tablet"],
  [/폰\s?케이스|휴대폰|핸드폰|스마트폰|아이폰|iphone|갤럭시\s?(s\s?\d|a\s?\d|노트\s?\d|z|폴드|플립)|폴더블/i, "electronics.phone"],
  [/워치|스피커|카메라|손\s?선풍기|가습기|전자\s?사전|게임기|닌텐도/, "electronics.other"],

  // A keyring attached to keys is still keys; a bare 열쇠고리 is a keyring.
  [/열쇠(?!\s?고리)|자동차\s?키|차\s?키|스마트\s?키|도어\s?키|카드\s?키|자물쇠/, "living.key"],

  // Accessories. Glasses cloths/lens cases are not glasses.
  [/안경\s?닦이|안경\s?천|렌즈\s?케이스/, "living.other"],
  [/안경|선글라스|뿔테/, "accessory.glasses"],
  [/시계|반지|목걸이|귀걸이|팔찌|피어싱|브로치/, "accessory.watch_jewelry"],
  [/집게\s?핀|머리\s?끈|헤어\s?(핀|밴드|클립|끈)|곱창\s?밴드|머리띠|실핀/, "accessory.hair"],
  [/키링|키\s?홀더|열쇠\s?고리|인형|뱃지|배지/, "accessory.keyring_charm"],

  [/우산|양산/, "living.umbrella"],
  [/텀블러|보온병|물병|물통|날진|보틀/, "living.tumbler_bottle"],

  // Bags. Before books ("책가방").
  [/파우치|화장품\s?(가방|주머니)/, "bag.pouch"],
  [/백팩|배낭|책가방|잔스포츠/, "bag.backpack"],
  [/토트|에코\s?백|천\s?가방|캔버스\s?백/, "bag.tote_eco"],
  [/쇼핑\s?백|종이\s?가방/, "bag.shopping_bag"],
  [/도시락\s?가방|보냉\s?백|크로스\s?백|숄더\s?백|메신저\s?백|슬링\s?백|힙\s?색/, "bag.other"],
  [/가방/, "bag"],

  // Stationery. Pencil cases before pens.
  [/필통|펜\s?케이스/, "stationery.pencil_case"],
  [/계산기/, "stationery.calculator"],
  [/볼펜|샤프|만년필|형광펜|사인펜|네임펜|연필|펜/, "stationery.pen_pencil"],
  [/지우개|수정\s?테이프|포스트잇|스테이플러/, "stationery.other"],

  // Books & documents. Notebooks before books; "노트북" matched above.
  [/노트|수첩|다이어리|플래너/, "book_document.notebook"],
  [/전공\s?(서적|책)|교재|자료구조|알고리즘|미적분|문제집|교과서|원론|개론|토익|토플|수험서/, "book_document.textbook"],
  [/소설|에세이|시집|만화책|잡지|동화책/, "book_document.general_book"],
  [/서류|파일|악보|문서|유인물/, "book_document.document_file"],
  [/책(?!상)/, "book_document"],

  // Clothing.
  [/모자|볼\s?캡|비니|버킷\s?햇/, "clothing.hat"],
  [/목도리|머플러|장갑|넥\s?워머|스카프/, "clothing.scarf_gloves"],
  [/신발|운동화|슬리퍼|구두|샌들|크록스|스니커즈|실내화|부츠/, "clothing.shoes"],
  [/바지|청바지|치마|스커트|슬랙스|레깅스/, "clothing.bottom"],
  [/후드|맨투맨|패딩|코트|자켓|재킷|점퍼|과잠|가디건|셔츠|니트|상의|조끼|바람막이|체육복/, "clothing.top_outer"],
  [/양말|잠옷/, "clothing.other"],
  [/옷/, "clothing"],

  // Everyday items.
  [/줄넘기|글러브|라켓|손목\s?보호대|요가\s?매트|농구공|축구공|배구공|야구공|테니스공|셔틀콕|악기|기타\s?피크/, "living.hobby_sports"],
  [/목베개|담요|고데기|립밤|도장|손거울|핸드크림/, "living.other"],

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
  if (fromTitle) return toSuggestion(fromTitle, "title");
  const fromDescription = description ? match(description) : null;
  return fromDescription ? toSuggestion(fromDescription, "description") : null;
}

// Exposed for tests: every rule target must be a valid taxonomy code.
export const SUGGESTION_RULE_TARGETS: readonly RuleTarget[] = RULES.map(([, target]) => target);
