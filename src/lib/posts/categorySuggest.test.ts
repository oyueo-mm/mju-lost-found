import { describe, expect, it } from "vitest";

import { SUGGESTION_RULE_TARGETS, suggestCategory } from "./categorySuggest";
import { isCategoryCode, isSubcategoryCode } from "./categoryTaxonomy";

const fromTitle = (title: string) => {
  const suggestion = suggestCategory({ title });
  return suggestion && { category: suggestion.category, subcategory: suggestion.subcategory };
};

describe("suggestCategory", () => {
  it("only targets real taxonomy codes", () => {
    for (const target of SUGGESTION_RULE_TARGETS) {
      expect(isCategoryCode(target) || isSubcategoryCode(target), target).toBe(true);
    }
  });

  it.each([
    // classification policy
    ["투명 폰케이스만 주웠어요", "electronics.phone"],
    ["에어팟 실리콘 커버만 잃어버렸어요", "electronics.earphones"],
    ["분홍색 에어팟 케이스 습득", "electronics.earphones"],
    ["실리콘 이어팁 한 쌍 주웠어요", "electronics.earphones"],
    ["투명 학생증 케이스 분실", "wallet.card_case"],
    ["목걸이 카드지갑 잃어버렸어요", "wallet.card_case"],
    ["파란 목걸이 카드케이스", "wallet.card_case"],
    ["폰 뒤에 붙이는 카드 포켓 분실", "wallet.card_wallet"],
    ["휴대폰 카드케이스 주웠어요", "wallet.card_case"],
    ["노트북 파우치 분실", "bag.pouch"],
    ["트랙 옆에서 화장품 파우치 습득", "bag.pouch"],
    ["토끼 키링 달린 열쇠", "living.key"],
    ["동아리방 열쇠 분실 (곰돌이 키링)", "living.key"],
    ["아이돌 포토카드 주웠어요", "living.hobby"],
    ["우노 카드 잃어버렸어요", "living.hobby"],
    // confusable pairs resolved by the object itself
    ["맥북 충전기 주웠어요", "electronics.charger"],
    ["갤럭시북 노트북 주웠어요", "electronics.laptop"],
    ["갤럭시 S펜 습득", "electronics.peripheral"],
    ["애플펜슬만 주웠어요", "electronics.peripheral"],
    ["흰색 C타입 케이블 주웠어요", "electronics.cable"],
    ["애플 맥세이프 배터리 잃어버렸어요", "electronics.power_bank"],
    ["랜선 주웠어요", "electronics.cable"],
    ["휴대용 가습기 잃어버렸어요", "electronics.other"],
    ["파란 표지 알고리즘 책", "book_document.major_book"],
    ["검은색 버즈 한쪽 분실", "electronics.earphones"],
    ["아이폰 15 분실", "electronics.phone"],
    ["공학용 계산기 잃어버렸어요", "stationery.calculator"],
    ["보라색 필통 주웠어요", "stationery.pencil_case"],
    ["검정 볼펜 한 자루", "stationery.pen"],
    ["빨간 노트 주웠어요", "book_document.notebook"],
    ["자료구조 교재 분실", "book_document.major_book"],
    ["서류 든 L자 파일 분실", "book_document.file"],
    ["도서관에서 소설책 습득", "book_document.general_book"],
    ["네이비 반지갑 주웠어요", "wallet.bifold"],
    ["학생증 한 장 주웠어요", "card_id.student_id"],
    ["교통카드 한 장 습득 (파란색)", "card_id.transit_card"],
    ["노란 체크카드 분실 (신한)", "card_id.debit_card"],
    ["잔스포츠 백팩 분실", "bag.backpack"],
    ["베이지 에코백 주웠어요", "bag.eco_bag"],
    ["올리브영 쇼핑백 두고 내렸어요", "bag.shopping_bag"],
    ["남색 후드티 주웠어요", "clothing.top"],
    ["검정 슬랙스 분실", "clothing.bottom"],
    ["흰 운동화 한 켤레", "clothing.shoes"],
    ["검정 볼캡 습득", "clothing.hat"],
    ["회색 목도리 주웠어요", "clothing.scarf"],
    ["뿔테 안경 분실", "accessory.glasses"],
    ["안경닦이 천 주웠어요", "living.other"],
    ["은반지 잃어버렸어요", "accessory.jewelry"],
    ["집게핀 주웠어요", "accessory.hair"],
    ["곰돌이 키링만 떨어져 있었어요", "accessory.keyring"],
    ["검정 장우산 분실", "living.umbrella"],
    ["스탠리 텀블러 분실", "living.tumbler"],
    ["배드민턴 라켓 습득", "living.sports"],
    // split kinds
    ["검정 가죽 카드지갑 잃어버렸어요", "wallet.card_wallet"],
    ["아이패드 에어 + 애플펜슬 분실", "electronics.tablet"],
    ["교직원증 주웠어요", "card_id.id_card"],
    ["자전거 자물쇠 주웠어요", "living.other"],
    ["고데기 주웠어요", "electronics.other"],
    ["소니 헤드폰 분실", "electronics.headphones"],
    ["에어팟 맥스 주웠어요", "electronics.headphones"],
    ["아이패드 에어 분실", "electronics.tablet"],
    ["삼성 USB 메모리 주웠어요", "electronics.storage"],
    ["USB 허브 습득", "electronics.peripheral"],
    ["보조배터리 잃어버렸어요", "electronics.power_bank"],
    ["검정 장지갑 분실", "wallet.long_wallet"],
    ["신분증 잃어버렸어요", "card_id.id_card"],
    ["현대카드 신용카드 분실", "card_id.credit_card"],
    ["흰색 토트백 주웠어요", "bag.tote"],
    ["검정 롱패딩 분실", "clothing.outer"],
    ["털장갑 한 짝", "clothing.gloves"],
    ["레이밴 선글라스 분실", "accessory.sunglasses"],
    ["애플워치 스트랩 말고 손목시계", "electronics.other"],
    ["가죽 손목시계 분실", "accessory.watch"],
    ["곰돌이 인형 뱃지 주웠어요", "accessory.charm"],
    ["다이어리 잃어버렸어요", "book_document.planner"],
    ["기말 과제 서류 분실", "book_document.document"],
    ["제도 샤프 분실", "stationery.mechanical_pencil"],
    ["흰 양산 두고 갔어요", "living.parasol"],
    ["날진 물병 분실", "living.water_bottle"],
  ])("%s -> %s", (title, subcategory) => {
    expect(fromTitle(title)?.subcategory).toBe(subcategory);
    expect(fromTitle(title)?.category).toBe(subcategory.split(".")[0]);
  });

  it("reads '지갑은 있는데 카드만' as a card, not a wallet", () => {
    expect(fromTitle("지갑은 있는데 카드만 빠졌어요")?.category).toBe("card_id");
  });

  it("suggests only the category (subcategory null) for a generic word", () => {
    expect(fromTitle("카드 한 장 주웠어요")).toEqual({ category: "card_id", subcategory: null });
    expect(fromTitle("가방 하나 주웠어요")).toEqual({ category: "bag", subcategory: null });
    expect(fromTitle("지갑 잃어버렸어요")).toEqual({ category: "wallet", subcategory: null });
  });

  it("prefers the title and falls back to the description as a weaker hint", () => {
    expect(suggestCategory({ title: "검정 볼캡", description: "안에 에어팟이 들어 있어요" })).toEqual({
      category: "clothing",
      subcategory: "clothing.hat",
      source: "title",
    });
    expect(
      suggestCategory({ title: "행정동 벤치에서 주웠어요", description: "베이지색 배낭이 놓여 있었어요." }),
    ).toEqual({ category: "bag", subcategory: "bag.backpack", source: "description" });
  });

  it("fills a generic title's subcategory from the description only within the same category", () => {
    expect(suggestCategory({ title: "정문 셔틀 정류장에서 하얀 카드 한 장", description: "티머니 로고만 있는 흰 카드" })).toEqual({
      category: "card_id",
      subcategory: "card_id.transit_card",
      source: "description",
    });
    expect(suggestCategory({ title: "행정동 벤치에 가방 하나", description: "베이지색 배낭이 놓여 있었어요. 뱃지가 잔뜩 달려 있어요." })).toEqual({
      category: "bag",
      subcategory: "bag.backpack",
      source: "description",
    });
    // The description names a different category: keep the title's category, subcategory unknown.
    expect(suggestCategory({ title: "카드 한 장 주웠어요", description: "에어팟 옆에 떨어져 있었어요" })).toEqual({
      category: "card_id",
      subcategory: null,
      source: "title",
    });
  });

  it("returns null instead of guessing 'other' when nothing matches", () => {
    expect(suggestCategory({ title: "이거 주인 찾아요", description: "정문 앞에 있었어요" })).toBeNull();
    expect(suggestCategory({ title: "", description: null })).toBeNull();
    expect(suggestCategory({})).toBeNull();
  });
});
