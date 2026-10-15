import type { ComponentType, SVGProps } from "react";

import {
  BagIcon,
  BookIcon,
  CardIcon,
  EarbudsIcon,
  GridIcon,
  HeadphonesIcon,
  LipstickIcon,
  MoreIcon,
  PenIcon,
  PhoneIcon,
  RingIcon,
  ShirtIcon,
  WalletIcon,
  WatchIcon,
} from "@/components/icons";
import { LEGACY_CATEGORY_TO_CODE } from "@/lib/posts/categoryMigration";
import { isCategoryCode, type CategoryCode } from "@/lib/posts/categoryTaxonomy";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// One line icon per 대분류 -- shared by the home category shortcuts and the
// post card's no-photo tile, so a category always reads the same way. The
// icons inherit the parent's text color (light/dark handled there).
export const CATEGORY_ICONS: Record<CategoryCode, IconComponent> = {
  electronics: HeadphonesIcon,
  phone: PhoneIcon,
  earphones: EarbudsIcon,
  watch: WatchIcon,
  wallet: WalletIcon,
  card_id: CardIcon,
  bag: BagIcon,
  clothing: ShirtIcon,
  accessory: RingIcon,
  book_document: BookIcon,
  stationery: PenIcon,
  living: GridIcon,
  cosmetics: LipstickIcon,
  etc: MoreIcon,
};

// A post's icon: its taxonomy code, else the code its legacy free-text
// category maps to, else the neutral "기타" icon.
export function categoryIconFor(post: { category: string; categoryCode?: string | null }): IconComponent {
  if (isCategoryCode(post.categoryCode)) return CATEGORY_ICONS[post.categoryCode];
  const legacy = post.category?.trim() ?? "";
  if (Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_TO_CODE, legacy)) return CATEGORY_ICONS[LEGACY_CATEGORY_TO_CODE[legacy]];
  return MoreIcon;
}
