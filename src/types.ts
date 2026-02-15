export type MenuCategory =
  | 'potsticker'
  | 'dumpling'
  | 'side'
  | 'soup_drink'
  | 'soup_dumpling'
  | 'noodle';

export type MenuOptionType = 'none' | 'tofu_sauce' | 'noodle_staple' | 'soup_dumpling_flavor';

export type TofuSauce = '麻醬' | '蠔油';
export type NoodleStaple = '麵條' | '冬粉';

export interface MenuCategoryMeta {
  id: MenuCategory;
  label: string;
  subtitle: string;
}

export interface MenuItem {
  id: string;
  category: MenuCategory;
  name: string;
  price: number;
  unit: '顆' | '份' | '碗' | '杯';
  optionType: MenuOptionType;
  description?: string;
  fixedDumplingCount?: number;
  baseDumplingPrice?: number;
}

export interface DumplingFlavor {
  id: string;
  name: string;
  price: number;
}

export interface RecommendationLine {
  menuItemId: string;
  quantity: number;
  tofuSauce?: TofuSauce;
  noodleStaple?: NoodleStaple;
  soupFlavorId?: string;
}

export interface RecommendationSet {
  id: string;
  title: string;
  description: string;
  lines: RecommendationLine[];
}

export interface AuthStore {
  id: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthUser {
  id: string;
  displayName: string;
  storeId: string;
  storeName: string;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AuthSessionPayload {
  store: AuthStore;
  user: AuthUser;
  locked_session?: boolean;
  work_mode?: string | null;
  work_target?: string | null;
  last_mode?: string | null;
  last_target?: string | null;
}

export interface AuthSessionMetadata {
  locked_session?: boolean;
  work_mode?: string | null;
  work_target?: string | null;
  last_mode?: string | null;
  last_target?: string | null;
}
