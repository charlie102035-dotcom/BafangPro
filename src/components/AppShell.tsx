import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import '../index.css';
import {
  OrdersApiError,
  ordersApi,
  type OrdersReviewListItem,
  type ReviewOrderDetail,
} from '../lib/ordersApi';
import { authApi } from '../lib/authApi';
import { backofficeApi } from '../lib/backofficeApi';
import IngestEnginePanel from './IngestEnginePanel';
import {
  DUMPLING_FLAVORS,
  MENU_CATEGORIES,
  MENU_ITEMS,
} from '../data/menu';
import type {
  AuthUser,
  MenuCategory,
  MenuItem,
  MenuOptionType,
  NoodleStaple,
  TofuSauce,
} from '../types';

const currency = (value: number) => `NT$${value.toLocaleString('zh-TW')}`;
const formatDelta = (value: number) => (Number.isInteger(value) ? `${value}` : value.toFixed(1));
const formatShortTime = (value: number | null) =>
  value ? new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '--:--';

type CartLine = {
  id: string;
  mergeKey: string;
  menuItemId: string;
  name: string;
  unitLabel: string;
  unitPrice: number;
  quantity: number;
  customLabel?: string;
  note?: string;
  soupSurchargePerUnit?: number;
  soupFlavorName?: string;
  soupFlavorPrice?: number;
  soupBaseFlavorPrice?: number;
  soupDumplingCount?: number;
};

type BoxOrderCategory = 'potsticker' | 'dumpling';

type BoxOption = {
  id: string;
  label: string;
  capacity: number;
};

type BoxLineItem = {
  fillingId: string;
  count: number;
};

type BoxSelection = {
  id: string;
  optionId: string;
  type: BoxOrderCategory;
  items: BoxLineItem[];
};

type AddedFeedback = {
  id: string;
  stamp: number;
  phase: 'pulse' | 'settle';
};

type BoxReminder = {
  category: BoxOrderCategory;
  boxId?: string;
  stamp: number;
  phase: 'flash' | 'settle';
  reason: 'incomplete' | 'empty';
};

type FastTapHint = {
  key: string;
  stamp: number;
  phase: 'show' | 'hide';
};

type WaterTransferFx = {
  taskId: string;
  slot: number;
  stamp: number;
  phase: 'show' | 'hide';
};

type SettingsSaveNotice = {
  stamp: number;
  phase: 'show' | 'hide';
  rebooted: boolean;
};

type CustomerPage = 'landing' | 'ordering' | 'cart';
type AppPerspective = 'customer' | 'production' | 'packaging' | 'settings' | 'ingest';
type SettingsPanel = 'stations' | 'menu' | 'apiHub';

type DeviceAuthMethod = 'none' | 'api_key' | 'bearer_token';
type DeviceConnectionStatus = 'unknown' | 'ok' | 'error';
type HardwareDeviceType = 'receipt_printer' | 'label_printer' | 'scale' | 'display' | 'kds' | 'other';

type ApiHubDevice = {
  id: string;
  name: string;
  deviceType: HardwareDeviceType;
  endpointUrl: string;
  authMethod: DeviceAuthMethod;
  authSecret: string;
  enabled: boolean;
  note: string;
  lastTestStatus: DeviceConnectionStatus;
  lastTestAt: number | null;
};
type PrepStation = 'none' | ProductionSection;
type PackagingStatus = 'waiting_pickup' | 'served';
type PackagingItemTrackStatus = 'queued' | 'in_progress' | 'ready' | 'packed' | 'issue';
type PackagingLaneId = string;
type RoutingMatchMode = 'any' | 'yes' | 'no';
type WorkflowMatchMode = 'all' | 'any';
type WorkflowDependencyMode = 'all';
type FeatureFlagKey = 'apiHub' | 'ingestEngine' | 'customerTutorial';
type FeatureFlags = Record<FeatureFlagKey, boolean>;
type StationLanguage = 'zh-TW' | 'vi' | 'my' | 'id';
type WorkflowStationTagRule = {
  id: string;
  tag: string;
  mode: RoutingMatchMode;
};
type WorkflowStation = {
  id: string;
  name: string;
  enabled: boolean;
  module: ProductionSection | 'packaging';
  serviceMode: 'any' | ServiceMode;
  matchMode: WorkflowMatchMode;
  categoryRules: Record<MenuCategory, RoutingMatchMode>;
  tagRules: WorkflowStationTagRule[];
  language?: StationLanguage;
};
type WorkflowMenuItem = MenuItem & {
  tags: string[];
  soldOut: boolean;
  custom: boolean;
  dependencyMode: WorkflowDependencyMode;
  dependencyItemIds: string[];
  prepStation: PrepStation;
  prepSeconds: number;
};
type WorkflowSettings = {
  productionStations: WorkflowStation[];
  packagingStations: WorkflowStation[];
  menuItems: WorkflowMenuItem[];
  menuTags: string[];
};
type MenuAvailabilityState = {
  directSoldOut: boolean;
  dependencySoldOut: boolean;
  unavailable: boolean;
  blockingDependencyIds: string[];
};
type PackagingChecklistItem = {
  key: string;
  categoryKey: string;
  categoryLabel: string;
  groupKey: string;
  groupLabel: string;
  partLabel?: string;
  label: string;
  quantity: number;
  quantityUnit?: string;
  detail?: string;
  showServiceModeTag?: boolean;
  baseStatus: PackagingItemTrackStatus;
  etaSeconds: number | null;
  progressPercent: number | null;
  source: 'griddle' | 'water' | 'direct';
  note?: string;
};

type SubmitNotice = {
  orderId: string;
  stamp: number;
  phase: 'show' | 'hide';
};

type IngestDispatchNotice = {
  id: string;
  sourceOrderId: string;
  systemOrderId: string;
  createdAt: number;
};

type SeedOrdersNotice = {
  count: number;
  stamp: number;
  phase: 'show' | 'hide';
};

type ReviewAlertToast = {
  id: string;
  text: string;
  phase: 'show' | 'hide';
};

type CustomerTutorialStep =
  | 'box_add'
  | 'box_switch'
  | 'box_fill'
  | 'switch_category'
  | 'add_item_open';
type CustomerTutorialPreference = {
  enabled: boolean;
  completed: boolean;
};
type TutorialSpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type ServiceMode = 'dine_in' | 'takeout';

type SubmittedOrder = {
  id: string;
  createdAt: number;
  serviceMode: ServiceMode;
  totalAmount: number;
  totalCount: number;
  orderNote?: string;
  cartLines: CartLine[];
  boxRows: Array<{
    id: string;
    boxLabel: string;
    typeLabel: string;
    items: Array<{ name: string; count: number; unitPrice: number; subtotal: number }>;
    subtotal: number;
  }>;
};

type ProductionSection = 'griddle' | 'dumpling' | 'noodle';

type FryStationId = 'griddle_a' | 'griddle_b';
type FryPreviewPanel = 'backlog' | 'frying';
type WaterTaskType = 'dumpling' | 'noodle' | 'side_heat';
type WaterTaskStatus = 'queued' | 'cooking' | 'done';

type FryFlavorCount = {
  name: string;
  count: number;
};

type FryOrderEntry = {
  entryId: string;
  orderId: string;
  entryLabel: string;
  priority: number;
  createdAt: number;
  serviceMode: ServiceMode;
  potstickerCount: number;
  flavorCounts: FryFlavorCount[];
  durationSeconds: number;
};

type LockedFryBatch = {
  entryIds: string[];
  orderIds: string[];
  totalPotstickers: number;
  orders: FryOrderEntry[];
  durationSeconds: number;
  lockedAt: number;
  timerStartedAt: number | null;
};

type FryStationState = {
  id: FryStationId;
  label: string;
  capacity: number;
  frySeconds: number;
  lockedBatch: LockedFryBatch | null;
};

type FryRecommendation = {
  orders: FryOrderEntry[];
  totalPotstickers: number;
  blockedOrder: FryOrderEntry | null;
};

type WaterTask = {
  taskId: string;
  orderId: string;
  createdAt: number;
  serviceMode: ServiceMode;
  type: WaterTaskType;
  title: string;
  quantity: number;
  unitLabel: string;
  note?: string;
  details: string[];
  flavorCounts: FryFlavorCount[];
  requiresLadle: boolean;
  durationSeconds: number;
  priority: number;
};

type WaterTaskProgress = {
  status: WaterTaskStatus;
  startedAt: number | null;
  ladleSlot: number | null;
};

type WaterDumplingBatchRecommendation = {
  tasks: WaterTask[];
  totalCount: number;
  overflowFallback: boolean;
};

type UserRuntimeSnapshot = {
  version: 1;
  activePerspective: AppPerspective;
  customerPage: CustomerPage;
  serviceMode: ServiceMode | null;
  activeCategory: MenuCategory;
  cart: CartLine[];
  cartOrderNote: string;
  boxState: Record<BoxOrderCategory, BoxSelection[]>;
  activeBoxState: Record<BoxOrderCategory, string>;
  orderSequence: number;
  productionOrders: SubmittedOrder[];
  packagingOrders: SubmittedOrder[];
  packagingStatusByOrderId: Record<string, PackagingStatus>;
  packagingItemStatusOverrides: Record<string, Record<string, PackagingItemTrackStatus>>;
  packagingPinnedOrderIds: string[];
  workflowOrderNotes: Record<string, string>;
  archivedOrderIds: string[];
  friedEntryIds: string[];
  friedPotstickerPieces: number;
  fryStations: Record<FryStationId, FryStationState>;
  splitOrderIds: string[];
  waterLadleCountByStationId: Record<string, number>;
  waterTaskProgress: Record<string, WaterTaskProgress>;
  waterUnlockedTaskIds: string[];
  waterDumplingTargetCount: number;
  waterDumplingCapturedTaskIds: string[];
  productionSection: ProductionSection;
  activeProductionStationIndexBySection: Record<ProductionSection, number>;
  activePackagingLane: PackagingLaneId;
  packagingTopQueueSize: 'md' | 'lg';
  packagingTopQueueLimit: number;
  packagingTopQueueLimitInput: string;
};

const BOX_OPTIONS: BoxOption[] = [
  { id: 'box-20', label: '20入', capacity: 20 },
];
const BOX_MAX_PIECES_PER_BOX = 20;

const FRY_STATION_ORDER: FryStationId[] = ['griddle_a', 'griddle_b'];
const FRY_BATCH_SECONDS = 20;
const WATER_DUMPLING_SECONDS = 70;
const WATER_NOODLE_SECONDS = 45;
const WATER_VERMICELLI_SECONDS = 35;
const WATER_SIDE_HEAT_SECONDS = 28;
const TUTORIAL_BOX_FILL_TARGET = 4;
const DEFAULT_WATER_LADLE_COUNT = 2;
const MAX_CONFIG_QUANTITY = 9999;
const WORKFLOW_SETTINGS_STORAGE_KEY = 'bafang.workflow.settings.v1';
const CUSTOMER_TUTORIAL_STORAGE_KEY = 'bafang.customer.tutorial.v1';
const USER_RUNTIME_STORAGE_KEY = 'bafang.user.runtime.v1';
const API_HUB_STORAGE_KEY = 'bafang.api-hub.devices.v1';
const FEATURE_FLAGS_STORAGE_KEY = 'bafang.feature-flags.v1';
const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  apiHub: true, ingestEngine: true, customerTutorial: true,
};
const STATION_LANGUAGES: Array<{ code: StationLanguage; label: string }> = [
  { code: 'zh-TW', label: '中' },
  { code: 'vi', label: 'VI' },
  { code: 'my', label: 'MY' },
  { code: 'id', label: 'ID' },
];

const PROD_I18N: Record<string, Record<StationLanguage, string>> = {
  section_griddle: { 'zh-TW': '煎台', vi: 'Chiên', my: 'ကြော်ခုံ', id: 'Panggang' },
  section_dumpling: { 'zh-TW': '水餃', vi: 'Sủi cảo', my: 'ပေါင်းမုန့်', id: 'Pangsit' },
  section_noodle: { 'zh-TW': '麵台', vi: 'Quầy mì', my: 'ခေါက်ဆွဲခုံ', id: 'Meja mie' },
  waiting_to_cook: { 'zh-TW': '待下鍋', vi: 'Chờ chiên', my: 'ချက်ရန်စောင့်', id: 'Menunggu dimasak' },
  frying: { 'zh-TW': '煎製中', vi: 'Đang chiên', my: 'ကြော်နေသည်', id: 'Sedang digoreng' },
  completed: { 'zh-TW': '已完成', vi: 'Hoàn thành', my: 'ပြီးဆုံးပြီ', id: 'Selesai' },
  collapse: { 'zh-TW': '收合', vi: 'Thu gọn', my: 'ခေါက်သိမ်း', id: 'Tutup' },
  view: { 'zh-TW': '查看', vi: 'Xem', my: 'ကြည့်ရှု', id: 'Lihat' },
  drop_in_pan: { 'zh-TW': '下鍋', vi: 'Cho vào chảo', my: 'အိုးထဲထည့်', id: 'Masukkan' },
  lift_pot: { 'zh-TW': '起鍋', vi: 'Vớt ra', my: 'ထုတ်ယူ', id: 'Angkat' },
  lock: { 'zh-TW': '鎖定', vi: 'Khóa', my: 'လော့ခ်', id: 'Kunci' },
  unlock: { 'zh-TW': '解鎖', vi: 'Mở khóa', my: 'လော့ခ်ဖွင့်', id: 'Buka kunci' },
  single_load: { 'zh-TW': '單次負荷', vi: 'Tải một lần', my: 'တစ်ကြိမ်ဝန်', id: 'Kapasitas sekali' },
  fry_duration: { 'zh-TW': '煎製時長', vi: 'Thời gian chiên', my: 'ကြော်ချိန်', id: 'Durasi goreng' },
  recalculate: { 'zh-TW': '重新估算', vi: 'Tính lại', my: 'ပြန်တွက်', id: 'Hitung ulang' },
  batch_flavor_stats: { 'zh-TW': '本鍋口味統計', vi: 'Thống kê vị lần này', my: 'ဤအကြိမ်အရသာစာရင်း', id: 'Statistik rasa batch ini' },
  unit_pieces: { 'zh-TW': '顆', vi: 'viên', my: 'လုံး', id: 'biji' },
  unit_batches: { 'zh-TW': '批', vi: 'lô', my: 'အသုတ်', id: 'batch' },
  estimated: { 'zh-TW': '預估', vi: 'Dự kiến', my: 'ခန့်မှန်း', id: 'Estimasi' },
  not_assigned_station: { 'zh-TW': '尚未分配煎台', vi: 'Chưa phân trạm', my: 'ခုံမသတ်မှတ်ရသေး', id: 'Belum ditentukan' },
  already_split: { 'zh-TW': '已拆單', vi: 'Đã tách', my: 'ခွဲပြီး', id: 'Sudah dipisah' },
  split_order: { 'zh-TW': '拆單', vi: 'Tách đơn', my: 'အော်ဒါခွဲ', id: 'Pisah pesanan' },
  lift_pot_done: { 'zh-TW': '起鍋完成', vi: 'Vớt xong', my: 'ထုတ်ယူပြီး', id: 'Angkat selesai' },
  collapse_order_detail: { 'zh-TW': '收合訂單明細', vi: 'Thu gọn chi tiết', my: 'အသေးစိတ်ခေါက်သိမ်း', id: 'Tutup detail pesanan' },
  view_order_detail: { 'zh-TW': '查看訂單明細', vi: 'Xem chi tiết', my: 'အသေးစိတ်ကြည့်', id: 'Lihat detail pesanan' },
  total_potsticker_count: { 'zh-TW': '累計鍋貼顆數', vi: 'Tổng bánh rán', my: 'စုစုပေါင်းပေါင်မုန့်', id: 'Total potsticker' },
  no_waiting_orders: { 'zh-TW': '目前無待下鍋訂單', vi: 'Không có đơn chờ', my: 'စောင့်ဆိုင်းမှာယူမှုမရှိ', id: 'Tidak ada pesanan menunggu' },
  no_active_batches: { 'zh-TW': '目前無進行中批次', vi: 'Không có lô đang chiên', my: 'လက်ရှိအသုတ်မရှိ', id: 'Tidak ada batch aktif' },
  no_cookable_batches: { 'zh-TW': '目前無可下鍋批次', vi: 'Không có lô để chiên', my: 'ချက်ရန်အသုတ်မရှိ', id: 'Tidak ada batch siap masak' },
  no_flavor_data: { 'zh-TW': '目前無口味資料', vi: 'Không có dữ liệu vị', my: 'အရသာဒေတာမရှိ', id: 'Tidak ada data rasa' },
  pending: { 'zh-TW': '待處理', vi: 'Chờ xử lý', my: 'လုပ်ဆောင်ရန်', id: 'Menunggu' },
  in_progress: { 'zh-TW': '進行中', vi: 'Đang xử lý', my: 'လုပ်ဆောင်နေ', id: 'Sedang proses' },
  n_orders: { 'zh-TW': '張訂單', vi: 'đơn hàng', my: 'မှာယူမှု', id: 'pesanan' },
  order_number: { 'zh-TW': '訂單編號', vi: 'Mã đơn hàng', my: 'မှာယူမှုနံပါတ်', id: 'Nomor pesanan' },
  no_pending_orders: { 'zh-TW': '目前無待處理訂單', vi: 'Không có đơn chờ xử lý', my: 'လုပ်ဆောင်ရန်မရှိ', id: 'Tidak ada pesanan menunggu' },
  no_completed_records: { 'zh-TW': '目前無完成紀錄', vi: 'Không có bản ghi hoàn thành', my: 'ပြီးဆုံးမှတ်တမ်းမရှိ', id: 'Tidak ada catatan selesai' },
  cooking: { 'zh-TW': '煮製中', vi: 'Đang nấu', my: 'ချက်နေသည်', id: 'Sedang dimasak' },
  task_dumpling: { 'zh-TW': '水餃', vi: 'Sủi cảo', my: 'ပေါင်းမုန့်', id: 'Pangsit' },
  task_noodle: { 'zh-TW': '麵/冬粉', vi: 'Mì/Miến', my: 'ခေါက်ဆွဲ/ဝူံချေ', id: 'Mie/Soun' },
  task_side_heat: { 'zh-TW': '加熱小菜', vi: 'Hâm món phụ', my: 'အပူပေးဟင်းလျာ', id: 'Panaskan lauk' },
  dumpling_orders: { 'zh-TW': '水餃訂單', vi: 'Đơn sủi cảo', my: 'ပေါင်းမုန့်မှာစာ', id: 'Pesanan pangsit' },
  scoop_out: { 'zh-TW': '撈起', vi: 'Vớt lên', my: 'ကောက်ယူ', id: 'Angkat' },
  scoop_done: { 'zh-TW': '撈起完成', vi: 'Vớt xong', my: 'ကောက်ယူပြီး', id: 'Selesai angkat' },
  confirm_force_end: { 'zh-TW': '確認強制結束', vi: 'Xác nhận kết thúc', my: 'အတင်းရပ်ရန်အတည်ပြု', id: 'Konfirmasi paksa selesai' },
  no_dumpling_orders: { 'zh-TW': '目前無水餃訂單', vi: 'Không có đơn sủi cảo', my: 'မှာယူမှုမရှိ', id: 'Tidak ada pesanan pangsit' },
  dumpling_grabber: { 'zh-TW': '水餃抓取器', vi: 'Bộ gắp sủi cảo', my: 'ဆွဲယူစက်', id: 'Pengambil pangsit' },
  batch_grab_target: { 'zh-TW': '批次抓取目標', vi: 'Mục tiêu lô', my: 'အသုတ်ပစ်မှတ်', id: 'Target batch' },
  grab_batch: { 'zh-TW': '抓取批次', vi: 'Gắp lô', my: 'အသုတ်ဆွဲယူ', id: 'Ambil batch' },
  cook_this_batch: { 'zh-TW': '這批下鍋', vi: 'Cho lô này vào', my: 'ဒီအသုတ်ချက်', id: 'Masak batch ini' },
  captured_batch: { 'zh-TW': '已抓取批次', vi: 'Lô đã gắp', my: 'ဆွဲယူပြီးအသုတ်', id: 'Batch diambil' },
  estimated_batch: { 'zh-TW': '預估批次', vi: 'Lô dự kiến', my: 'ခန့်မှန်းအသုတ်', id: 'Estimasi batch' },
  overflow_fallback: { 'zh-TW': '目標低於最早任務顆數，已抓最早一筆。', vi: 'Mục tiêu thấp hơn, đã gắp đơn đầu tiên.', my: 'ပစ်မှတ်နိမ့်နေ၍ အစောဆုံးကိုဆွဲယူပြီး။', id: 'Target lebih rendah, sudah diambil pesanan pertama.' },
  no_grabbable_batches: { 'zh-TW': '目前無可抓取水餃批次', vi: 'Không có lô sủi cảo', my: 'ဆွဲယူရန်အသုတ်မရှိ', id: 'Tidak ada batch pangsit' },
  waiting_pot: { 'zh-TW': '待下鍋', vi: 'Chờ vào nồi', my: 'အိုးထဲထည့်ရန်', id: 'Menunggu dimasak' },
  in_pot: { 'zh-TW': '鍋中', vi: 'Trong nồi', my: 'အိုးထဲ', id: 'Dalam panci' },
  ladle: { 'zh-TW': '麵杓', vi: 'Muôi mì', my: 'ခေါက်ဆွဲဇွန်း', id: 'Sendok mie' },
  ladle_count: { 'zh-TW': '麵杓數量', vi: 'Số muôi mì', my: 'ဇွန်းအရေအတွက်', id: 'Jumlah sendok' },
  standby: { 'zh-TW': '待命', vi: 'Chờ sẵn', my: 'အဆင်သင့်', id: 'Siaga' },
  tap_to_assign: { 'zh-TW': '點一下放入此麵杓', vi: 'Nhấn để đưa vào muôi', my: 'ဇွန်းထဲထည့်ရန်နှိပ်', id: 'Ketuk untuk masukkan' },
  select_order_first: { 'zh-TW': '先從右側選取訂單', vi: 'Chọn đơn bên phải trước', my: 'ညာဘက်မှအရင်ရွေး', id: 'Pilih pesanan dari kanan' },
  note: { 'zh-TW': '備註', vi: 'Ghi chú', my: 'မှတ်ချက်', id: 'Catatan' },
  select_reassign: { 'zh-TW': '選取改派', vi: 'Chọn chuyển', my: 'ပြောင်းရွေး', id: 'Pilih pindah' },
  return_to_queue: { 'zh-TW': '退回待處理', vi: 'Trả về hàng chờ', my: 'တန်းစီသို့ပြန်', id: 'Kembalikan ke antrian' },
  noodle_orders: { 'zh-TW': '麵台訂單', vi: 'Đơn quầy mì', my: 'ခေါက်ဆွဲမှာစာ', id: 'Pesanan mie' },
  selected_tap_ladle: { 'zh-TW': '已選取，請點左側麵杓', vi: 'Đã chọn, nhấn muôi bên trái', my: 'ရွေးပြီး ဘယ်ဘက်ဇွန်းနှိပ်', id: 'Terpilih, ketuk sendok kiri' },
  tap_to_select: { 'zh-TW': '點一下選取後，再點左側麵杓', vi: 'Nhấn chọn, rồi nhấn muôi bên trái', my: 'နှိပ်ရွေးပြီးဘယ်ဇွန်းနှိပ်', id: 'Ketuk pilih, lalu ketuk sendok kiri' },
  no_noodle_orders: { 'zh-TW': '目前無麵台訂單', vi: 'Không có đơn quầy mì', my: 'ခေါက်ဆွဲမှာယူမှုမရှိ', id: 'Tidak ada pesanan mie' },
  noodle_hint: { 'zh-TW': '先點右側訂單，再點左側麵杓直接搬入。', vi: 'Chọn đơn bên phải, nhấn muôi bên trái.', my: 'ညာဘက်မှာယူမှုနှိပ်ပြီးဘယ်ဘက်ဇွန်းနှိပ်။', id: 'Pilih pesanan kanan, ketuk sendok kiri.' },
  dine_in: { 'zh-TW': '內用', vi: 'Ăn tại chỗ', my: 'ဆိုင်တွင်းစား', id: 'Makan di tempat' },
  takeout: { 'zh-TW': '外帶', vi: 'Mang đi', my: 'ထုတ်ယူ', id: 'Bawa pulang' },
  current_station: { 'zh-TW': '目前工作站', vi: 'Trạm hiện tại', my: 'လက်ရှိအလုပ်ခုံ', id: 'Stasiun saat ini' },
  locked_suffix: { 'zh-TW': '（已鎖定）', vi: '(Đã khóa)', my: '(လော့ခ်ထားပြီ)', id: '(Terkunci)' },
  n_pending_batches: { 'zh-TW': '共 {n} 個待處理批次', vi: '{n} lô chờ xử lý', my: '{n} အသုတ်စောင့်နေ', id: '{n} batch menunggu' },
  total_n_pieces: { 'zh-TW': '總 {n} 顆', vi: 'Tổng {n} viên', my: 'စုစုပေါင်း {n} လုံး', id: 'Total {n} biji' },
  completed_n_tasks: { 'zh-TW': '完成 {n} 筆', vi: 'Hoàn thành {n}', my: '{n} ခုပြီးဆုံး', id: 'Selesai {n}' },
  queued_pieces: { 'zh-TW': '排隊顆數 {n} 顆', vi: 'Xếp hàng {n} viên', my: 'တန်းစီ {n} လုံး', id: 'Antrian {n} biji' },
  queued_ladles: { 'zh-TW': '排隊麵杓 {n} 筆', vi: 'Xếp hàng {n} muôi', my: 'တန်းစီ {n} ဇွန်း', id: 'Antrian {n} sendok' },
  pot_pieces: { 'zh-TW': '鍋中顆數 {n} 顆', vi: 'Trong nồi {n} viên', my: 'အိုးထဲ {n} လုံး', id: 'Dalam panci {n} biji' },
  cooking_n_tasks: { 'zh-TW': '煮製中 {n} 筆', vi: 'Đang nấu {n} mục', my: '{n} ခုချက်နေ', id: 'Memasak {n} item' },
  n_pieces_suffix: { 'zh-TW': '{n}顆', vi: '{n} viên', my: '{n} လုံး', id: '{n} biji' },
  n_tasks_suffix: { 'zh-TW': '{n} 筆', vi: '{n} mục', my: '{n} ခု', id: '{n} item' },
  n_sheets: { 'zh-TW': '{n} 張', vi: '{n} tờ', my: '{n} စောင်', id: '{n} lembar' },
  used_idle: { 'zh-TW': '使用中 {busy}/{total} · 空閒 {idle}', vi: 'Dùng {busy}/{total} · Rảnh {idle}', my: 'သုံးနေ {busy}/{total} · အား {idle}', id: 'Dipakai {busy}/{total} · Kosong {idle}' },
  selected_label: { 'zh-TW': '已選取：{label}', vi: 'Đã chọn: {label}', my: 'ရွေးပြီး: {label}', id: 'Terpilih: {label}' },
  selected_none: { 'zh-TW': '已選取：無', vi: 'Đã chọn: Không', my: 'ရွေးပြီး: မရှိ', id: 'Terpilih: Tidak ada' },
  note_prefix: { 'zh-TW': '備註：{note}', vi: 'Ghi chú: {note}', my: 'မှတ်ချက်: {note}', id: 'Catatan: {note}' },
  flavor_count: { 'zh-TW': '{name} {count}顆', vi: '{name} {count} viên', my: '{name} {count} လုံး', id: '{name} {count} biji' },
  lift_pot_countdown: { 'zh-TW': '起鍋 {n}s', vi: 'Vớt {n}s', my: 'ထုတ်ယူ {n}s', id: 'Angkat {n}s' },
  scoop_countdown: { 'zh-TW': '撈起 {n}s', vi: 'Vớt {n}s', my: 'ကောက်ယူ {n}s', id: 'Angkat {n}s' },
  ladle_n: { 'zh-TW': '麵杓 {n}', vi: 'Muôi {n}', my: 'ဇွန်း {n}', id: 'Sendok {n}' },
  one_batch: { 'zh-TW': '1 批', vi: '1 lô', my: '၁ အသုတ်', id: '1 batch' },
  overload_warning: { 'zh-TW': '最早單 {orderId} 需 {count} 顆，超出負荷，請調整容量', vi: 'Đơn sớm nhất {orderId} cần {count} viên, vượt tải', my: 'အစောဆုံး {orderId} သည် {count} လုံးလိုပြီး ဝန်ပိုနေသည်', id: 'Pesanan {orderId} butuh {count} biji, melebihi kapasitas' },
};

const pt = (key: string, lang: StationLanguage): string =>
  PROD_I18N[key]?.[lang] ?? PROD_I18N[key]?.['zh-TW'] ?? key;

const ptf = (key: string, lang: StationLanguage, vars: Record<string, string | number>): string => {
  let result = pt(key, lang);
  for (const [k, v] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return result;
};

const DEVICE_TYPE_LABEL: Record<HardwareDeviceType, string> = {
  receipt_printer: '出單機',
  label_printer: '標籤機',
  scale: '電子秤',
  display: '叫號螢幕',
  kds: 'KDS',
  other: '其他',
};
const DEVICE_TYPE_OPTIONS: HardwareDeviceType[] = [
  'receipt_printer', 'label_printer', 'scale', 'display', 'kds', 'other',
];
const AUTH_METHOD_LABEL: Record<DeviceAuthMethod, string> = {
  none: '無認證',
  api_key: 'API Key',
  bearer_token: 'Bearer Token',
};

type HardwareModuleId = 'fry' | 'call_output' | 'ingest';
type HardwareModuleConfig = Record<HardwareModuleId, boolean>;

const HW_MODULES_STORAGE_KEY = 'bafang.hw-modules.v1';
const DEFAULT_HW_MODULES: HardwareModuleConfig = { fry: true, call_output: true, ingest: true };

const HW_MODULE_REGISTRY: Array<{
  id: HardwareModuleId;
  label: string;
  description: string;
  apis: Array<{ method: 'POST' | 'GET'; pathTemplate: string; label: string; description: string }>;
}> = [
  {
    id: 'fry',
    label: '煎台自動化',
    description: '溫度感測器回報與目標溫度控制',
    apis: [
      { method: 'POST', pathTemplate: '/api/fry/stores/:storeId/sensors/temperature', label: '溫度回報', description: '感測器回報溫度讀數' },
      { method: 'POST', pathTemplate: '/api/fry/stores/:storeId/sensors/target', label: '目標溫度', description: '設定目標溫度' },
    ],
  },
  {
    id: 'call_output',
    label: '叫號系統',
    description: '叫號機連線',
    apis: [
      { method: 'POST', pathTemplate: '/api/call-output/stores/:storeId/enqueue', label: '叫號', description: '新增叫號' },
    ],
  },
  {
    id: 'ingest',
    label: '進單引擎',
    description: '外部 POS 系統送單',
    apis: [
      { method: 'POST', pathTemplate: '/api/orders/stores/:storeId/ingest-pos-text', label: '外部送單', description: '外部 POS 送單（文字解析）' },
    ],
  },
];
const CUSTOMER_TUTORIAL_STEPS: CustomerTutorialStep[] = [
  'box_add',
  'box_switch',
  'box_fill',
  'switch_category',
  'add_item_open',
];
const WORKFLOW_MENU_CATEGORIES: MenuCategory[] = [
  'potsticker',
  'dumpling',
  'side',
  'soup_drink',
  'soup_dumpling',
  'noodle',
];
const WORKFLOW_STATION_BADGE_ACCENTS = [
  'border-sky-200 bg-sky-50 text-sky-700',
  'border-emerald-200 bg-emerald-50 text-emerald-700',
  'border-sky-200 bg-sky-50 text-sky-700',
  'border-amber-200 bg-amber-50 text-amber-700',
  'border-rose-200 bg-rose-50 text-rose-700',
];
const PRODUCTION_MODULE_LABEL: Record<ProductionSection, string> = {
  griddle: '煎台',
  dumpling: '水餃',
  noodle: '麵台',
};
const PRODUCTION_MODULES: ProductionSection[] = ['griddle', 'dumpling', 'noodle'];
const PREP_STATION_LABEL: Record<PrepStation, string> = {
  none: '無',
  griddle: '煎台',
  dumpling: '水餃',
  noodle: '麵台',
};
const ORDER_NOTE_SAMPLES = [
  '餐具 2 套',
  '請分開打包',
  '18:30 後取餐',
  '飲料少冰',
  '外送到店門口',
];
const PREP_STATIONS: PrepStation[] = ['none', 'griddle', 'dumpling', 'noodle'];
const PREP_STATIONS_BY_CATEGORY: Record<MenuCategory, PrepStation[]> = {
  potsticker: ['none', 'griddle'],
  dumpling: ['none', 'dumpling'],
  side: ['none', 'noodle'],
  soup_drink: ['none', 'noodle'],
  soup_dumpling: ['none', 'dumpling'],
  noodle: ['none', 'noodle'],
};
const CATEGORY_TAG_BY_MENU_CATEGORY: Record<MenuCategory, string> = {
  potsticker: '鍋貼',
  dumpling: '水餃',
  side: '小菜',
  soup_drink: '湯飲',
  soup_dumpling: '湯餃',
  noodle: '麵類',
};

const withUserStorageScope = (baseKey: string, userId: string) =>
  `${baseKey}.${encodeURIComponent(userId)}`;

const ALL_PERSPECTIVES: AppPerspective[] = ['customer', 'production', 'packaging', 'settings', 'ingest'];
type WorkMode = 'production_station' | 'packaging_station' | 'command_hub';

const normalizePerspective = (value: unknown): AppPerspective | null => {
  if (value === 'customer' || value === 'production' || value === 'packaging' || value === 'settings' || value === 'ingest') {
    return value;
  }
  return null;
};

const normalizePerspectiveList = (value: unknown): AppPerspective[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<AppPerspective>();
  value.forEach((entry) => {
    const normalized = normalizePerspective(entry);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeProductionSection = (value: unknown): ProductionSection | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'griddle' || normalized === 'fry' || normalized === '煎台' || normalized === '鍋貼') {
    return 'griddle';
  }
  if (normalized === 'dumpling' || normalized === '水餃') {
    return 'dumpling';
  }
  if (normalized === 'noodle' || normalized === '麵台' || normalized === '麵') {
    return 'noodle';
  }
  return null;
};

const getValueByPath = (source: Record<string, unknown>, path: string[]): unknown => {
  let cursor: unknown = source;
  for (const key of path) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[key];
  }
  return cursor;
};

const readSettingStringByPath = (source: Record<string, unknown>, path: string[]): string | null => {
  const value = getValueByPath(source, path);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readSettingStringByPaths = (source: Record<string, unknown>, paths: string[][]): string | null => {
  for (const path of paths) {
    const value = readSettingStringByPath(source, path);
    if (value) return value;
  }
  return null;
};

type UserPerspectivePolicy = {
  workMode: WorkMode | null;
  lockedPerspective: AppPerspective | null;
  defaultPerspective: AppPerspective;
  allowedPerspectives: AppPerspective[];
  sessionLock: boolean;
  sessionWorkMode: WorkMode | null;
  sessionWorkTarget: string | null;
  preferredProductionSection: ProductionSection | null;
  preferredProductionStationId: string | null;
  preferredPackagingLaneId: string | null;
};

const resolveUserPerspectivePolicy = (authUser: AuthUser): UserPerspectivePolicy => {
  const settings = isRecord(authUser.settings) ? authUser.settings : {};
  const fallbackAllowed = [...ALL_PERSPECTIVES];

  const preferredProductionStationId = readSettingStringByPaths(
    settings,
    [
      ['productionStationId'],
      ['production_station_id'],
      ['productionStation', 'id'],
      ['production_station', 'id'],
      ['production', 'stationId'],
      ['production', 'station_id'],
      ['preferredProductionStationId'],
      ['preferred_production_station_id'],
      ['stationId'],
      ['station_id'],
      ['station', 'id'],
    ],
  );
  const preferredProductionSection = normalizeProductionSection(
    readSettingStringByPaths(
      settings,
      [
        ['preferredProductionSection'],
        ['preferred_production_section'],
        ['productionSection'],
        ['production_section'],
        ['productionModule'],
        ['production_module'],
        ['productionStation', 'section'],
        ['productionStation', 'module'],
        ['production_station', 'section'],
        ['production_station', 'module'],
        ['production', 'section'],
        ['production', 'module'],
        ['section'],
        ['module'],
        ['station', 'section'],
        ['station', 'module'],
        ['preferredStationId'],
        ['preferred_station_id'],
      ],
    ) ?? null,
  );
  const preferredPackagingLaneId = readSettingStringByPaths(
    settings,
    [
      ['preferredPackagingLane'],
      ['preferred_packaging_lane'],
      ['packagingStationId'],
      ['packaging_station_id'],
      ['packagingLaneId'],
      ['packaging_lane_id'],
      ['packagingStation', 'id'],
      ['packaging_station', 'id'],
      ['packaging', 'stationId'],
      ['packaging', 'station_id'],
      ['packaging', 'laneId'],
      ['packaging', 'lane_id'],
      ['preferredStationId'],
      ['preferred_station_id'],
      ['laneId'],
      ['lane_id'],
      ['stationId'],
      ['station_id'],
      ['station', 'id'],
    ],
  ) ?? null;

  const allowedFromSettings = normalizePerspectiveList(settings.allowedPerspectives);
  const allowedPerspectives = allowedFromSettings.length > 0
    ? Array.from(new Set([...ALL_PERSPECTIVES, ...allowedFromSettings]))
    : fallbackAllowed;
  const safeAllowedPerspectives = allowedPerspectives.length > 0
    ? allowedPerspectives
    : [...ALL_PERSPECTIVES];

  const defaultFromSettings = normalizePerspective(settings.defaultPerspective);
  const defaultPerspective = (
    defaultFromSettings && safeAllowedPerspectives.includes(defaultFromSettings)
      ? defaultFromSettings
      : safeAllowedPerspectives.includes('production')
        ? 'production'
        : safeAllowedPerspectives[0]
  ) ?? 'customer';

  return {
    workMode: null,
    lockedPerspective: null,
    defaultPerspective,
    allowedPerspectives: safeAllowedPerspectives,
    sessionLock: false,
    sessionWorkMode: null,
    sessionWorkTarget: null,
    preferredProductionSection,
    preferredProductionStationId,
    preferredPackagingLaneId,
  };
};

const readCustomerTutorialPreference = (storageKey: string): CustomerTutorialPreference => {
  if (typeof window === 'undefined') {
    return {
      enabled: true,
      completed: false,
    };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {
        enabled: true,
        completed: false,
      };
    }
    const parsed = JSON.parse(raw) as Partial<CustomerTutorialPreference>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      completed: typeof parsed.completed === 'boolean' ? parsed.completed : false,
    };
  } catch {
    return {
      enabled: true,
      completed: false,
    };
  }
};

const readFeatureFlags = (storageKey: string): FeatureFlags => {
  if (typeof window === 'undefined') return { ...DEFAULT_FEATURE_FLAGS };
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { ...DEFAULT_FEATURE_FLAGS };
    const parsed = JSON.parse(raw) as Partial<FeatureFlags>;
    return {
      apiHub: typeof parsed.apiHub === 'boolean' ? parsed.apiHub : true,
      ingestEngine: typeof parsed.ingestEngine === 'boolean' ? parsed.ingestEngine : true,
      customerTutorial: typeof parsed.customerTutorial === 'boolean' ? parsed.customerTutorial : true,
    };
  } catch { return { ...DEFAULT_FEATURE_FLAGS }; }
};

const readUserRuntimeSnapshot = (storageKey: string): Partial<UserRuntimeSnapshot> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Partial<UserRuntimeSnapshot>;
  } catch {
    return {};
  }
};

const sanitizeRoutingMode = (value: unknown): RoutingMatchMode =>
  value === 'yes' || value === 'no' ? value : 'any';

const normalizeWorkflowTag = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 16);

const sanitizeTagArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const normalized = normalizeWorkflowTag(entry);
    if (!normalized) return;
    unique.add(normalized);
  });
  return Array.from(unique);
};

const getDefaultDependencyItemIds = (item: MenuItem): string[] => {
  if (item.id === 'soup-dumpling-corn') return ['soup-corn'];
  if (item.id === 'soup-dumpling-hot-sour') return ['soup-hot-sour'];
  return [];
};

const createDefaultWorkflowMenuItems = (): WorkflowMenuItem[] =>
  MENU_ITEMS.map((item) => {
    const defaultPrep = getDefaultPrepConfigForMenuItem(item);
    return {
      ...item,
      tags: [CATEGORY_TAG_BY_MENU_CATEGORY[item.category]],
      soldOut: false,
      custom: false,
      dependencyMode: 'all',
      dependencyItemIds: getDefaultDependencyItemIds(item),
      prepStation: defaultPrep.prepStation,
      prepSeconds: defaultPrep.prepSeconds,
    };
  });

const createDefaultWorkflowMenuTags = (): string[] => {
  const tagSet = new Set<string>(Object.values(CATEGORY_TAG_BY_MENU_CATEGORY));
  return Array.from(tagSet);
};

const sanitizeMenuUnit = (value: unknown): WorkflowMenuItem['unit'] => {
  if (value === '顆' || value === '份' || value === '碗' || value === '杯') return value;
  return '份';
};

const sanitizeMenuOptionType = (value: unknown): MenuOptionType => {
  if (
    value === 'none' ||
    value === 'tofu_sauce' ||
    value === 'noodle_staple' ||
    value === 'soup_dumpling_flavor'
  ) {
    return value;
  }
  return 'none';
};

const getAllowedPrepStationsForCategory = (category: MenuCategory): PrepStation[] => {
  const allowed = PREP_STATIONS_BY_CATEGORY[category];
  return allowed.length > 0 ? allowed : PREP_STATIONS;
};

const sanitizePrepStation = (
  value: unknown,
  category: MenuCategory,
  fallback: PrepStation = 'none',
): PrepStation => {
  const allowed = getAllowedPrepStationsForCategory(category);
  if (typeof value === 'string' && allowed.includes(value as PrepStation)) {
    return value as PrepStation;
  }
  if (allowed.includes(fallback)) return fallback;
  return allowed[0] ?? 'none';
};

const sanitizePrepSeconds = (value: unknown, fallback: number, prepStation: PrepStation): number => {
  if (prepStation === 'none') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(1, Math.round(fallback) || 1);
  return Math.max(1, Math.round(parsed));
};

function getDefaultPrepConfigForMenuItem(
  item: Pick<MenuItem, 'id' | 'category'>,
): { prepStation: PrepStation; prepSeconds: number } {
  if (item.category === 'potsticker') {
    return { prepStation: 'griddle', prepSeconds: 20 };
  }
  if (item.category === 'dumpling') {
    return { prepStation: 'dumpling', prepSeconds: WATER_DUMPLING_SECONDS };
  }
  if (item.category === 'soup_dumpling') {
    return { prepStation: 'dumpling', prepSeconds: WATER_DUMPLING_SECONDS };
  }
  if (item.category === 'noodle') {
    return { prepStation: 'noodle', prepSeconds: WATER_NOODLE_SECONDS };
  }
  if (item.category === 'side') {
    if (HEATED_SIDE_MENU_IDS.has(item.id)) {
      return { prepStation: 'noodle', prepSeconds: WATER_SIDE_HEAT_SECONDS };
    }
    return { prepStation: 'none', prepSeconds: 0 };
  }
  return { prepStation: 'none', prepSeconds: 0 };
}

const sanitizeDependencyMode = (value: unknown): WorkflowDependencyMode => {
  if (value === 'all') return 'all';
  return 'all';
};

const sanitizeDependencyItemIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const normalized = entry.trim();
    if (!normalized) return;
    unique.add(normalized);
  });
  return Array.from(unique);
};

const createCategoryRules = (
  seed: Partial<Record<MenuCategory, RoutingMatchMode>> = {},
): Record<MenuCategory, RoutingMatchMode> =>
  WORKFLOW_MENU_CATEGORIES.reduce((acc, category) => {
    acc[category] = sanitizeRoutingMode(seed[category]);
    return acc;
  }, {} as Record<MenuCategory, RoutingMatchMode>);

const getCategoryRulesByProductionModule = (
  module: ProductionSection,
): Record<MenuCategory, RoutingMatchMode> => {
  if (module === 'griddle') {
    return createCategoryRules({
      potsticker: 'yes',
      dumpling: 'no',
      side: 'no',
      soup_drink: 'no',
      soup_dumpling: 'no',
      noodle: 'no',
    });
  }
  if (module === 'dumpling') {
    return createCategoryRules({
      potsticker: 'no',
      dumpling: 'yes',
      side: 'no',
      soup_drink: 'no',
      soup_dumpling: 'no',
      noodle: 'no',
    });
  }
  return createCategoryRules({
    potsticker: 'no',
    dumpling: 'no',
    side: 'yes',
    soup_drink: 'yes',
    soup_dumpling: 'yes',
    noodle: 'yes',
  });
};

const resolveProductionModuleFromStation = (
  station: Partial<WorkflowStation>,
): ProductionSection => {
  if (station.module === 'griddle' || station.module === 'dumpling' || station.module === 'noodle') {
    return station.module;
  }

  const stationId = typeof station.id === 'string' ? station.id.toLowerCase() : '';
  if (stationId.includes('noodle') || stationId.includes('麵')) return 'noodle';
  if (stationId.includes('dumpling') || stationId.includes('水餃')) return 'dumpling';
  if (stationId.includes('griddle') || stationId.includes('煎') || stationId.includes('鍋')) return 'griddle';

  const rules = createCategoryRules(station.categoryRules);
  if (rules.potsticker === 'yes') return 'griddle';
  if (rules.dumpling === 'yes' && rules.noodle !== 'yes' && rules.side !== 'yes' && rules.soup_dumpling !== 'yes') {
    return 'dumpling';
  }
  if (rules.noodle === 'yes' || rules.side === 'yes' || rules.soup_dumpling === 'yes') {
    return 'noodle';
  }
  return 'griddle';
};

const createDefaultProductionStations = (): WorkflowStation[] => [
  {
    id: 'production-griddle',
    name: '煎台',
    enabled: true,
    module: 'griddle',
    serviceMode: 'any',
    matchMode: 'any',
    categoryRules: getCategoryRulesByProductionModule('griddle'),
    tagRules: [],
  },
  {
    id: 'production-dumpling',
    name: '水餃',
    enabled: true,
    module: 'dumpling',
    serviceMode: 'any',
    matchMode: 'any',
    categoryRules: getCategoryRulesByProductionModule('dumpling'),
    tagRules: [],
  },
  {
    id: 'production-noodle',
    name: '麵台',
    enabled: true,
    module: 'noodle',
    serviceMode: 'any',
    matchMode: 'any',
    categoryRules: getCategoryRulesByProductionModule('noodle'),
    tagRules: [],
  },
];

const createDefaultPackagingStations = (): WorkflowStation[] => [
  {
    id: 'packaging-a',
    name: '包裝 A',
    enabled: true,
    module: 'packaging',
    serviceMode: 'any',
    matchMode: 'any',
    categoryRules: createCategoryRules(),
    tagRules: [],
  },
];

const createDefaultWorkflowSettings = (): WorkflowSettings => ({
  productionStations: createDefaultProductionStations(),
  packagingStations: createDefaultPackagingStations(),
  menuItems: createDefaultWorkflowMenuItems(),
  menuTags: createDefaultWorkflowMenuTags(),
});

const sanitizeStationList = (
  raw: unknown,
  fallback: WorkflowStation[],
  prefix: string,
): WorkflowStation[] => {
  if (!Array.isArray(raw)) {
    return fallback.map((station) => ({
      ...station,
      categoryRules: { ...station.categoryRules },
      tagRules: station.tagRules.map((rule) => ({ ...rule })),
    }));
  }

  const sanitized = raw
    .filter((entry): entry is Partial<WorkflowStation> => Boolean(entry) && typeof entry === 'object')
    .map((station, index) => {
      const module: WorkflowStation['module'] = prefix === 'production'
        ? resolveProductionModuleFromStation(station)
        : 'packaging';
      const serviceMode: WorkflowStation['serviceMode'] =
        station.serviceMode === 'dine_in' || station.serviceMode === 'takeout'
          ? station.serviceMode
          : 'any';
      const matchMode: WorkflowMatchMode = station.matchMode === 'all' ? 'all' : 'any';
      const rawTagRules = Array.isArray((station as { tagRules?: unknown[] }).tagRules)
        ? (station as { tagRules: unknown[] }).tagRules
        : [];
      const tagRules: WorkflowStationTagRule[] = rawTagRules
        .filter((entry): entry is Partial<WorkflowStationTagRule> => Boolean(entry) && typeof entry === 'object')
        .map((entry, tagIndex) => ({
          id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : `tag-rule-${index + 1}-${tagIndex + 1}`,
          tag: typeof entry.tag === 'string' ? normalizeWorkflowTag(entry.tag) : '',
          mode: sanitizeRoutingMode(entry.mode),
        }))
        .filter((entry) => entry.tag.length > 0 && entry.mode !== 'any');
      const rawCategoryRules = createCategoryRules(station.categoryRules);
      const hasExplicitCategoryRules = WORKFLOW_MENU_CATEGORIES.some(
        (category) => rawCategoryRules[category] !== 'any',
      );
      const categoryRules = prefix === 'production'
        ? (hasExplicitCategoryRules
          ? rawCategoryRules
          : getCategoryRulesByProductionModule(module as ProductionSection))
        : rawCategoryRules;
      return {
        id: typeof station.id === 'string' && station.id.trim()
          ? station.id.trim()
          : `${prefix}-${index + 1}`,
        name: typeof station.name === 'string' && station.name.trim()
          ? station.name.trim().slice(0, 20)
          : prefix === 'production'
            ? `${PRODUCTION_MODULE_LABEL[module as ProductionSection]} ${index + 1}`
            : `包裝站 ${index + 1}`,
        enabled: typeof station.enabled === 'boolean' ? station.enabled : true,
        module,
        serviceMode,
        matchMode,
        categoryRules,
        tagRules,
        language: (['vi','my','id'] as const).includes(station.language as any) ? station.language as StationLanguage : 'zh-TW',
      };
    });

  if (sanitized.length > 0) return sanitized;
  return fallback.map((station) => ({
    ...station,
    categoryRules: { ...station.categoryRules },
    tagRules: station.tagRules.map((rule) => ({ ...rule })),
  }));
};

const sanitizeWorkflowSettings = (value: unknown): WorkflowSettings => {
  const defaults = createDefaultWorkflowSettings();
  if (!value || typeof value !== 'object') return defaults;
  const candidate = value as Partial<WorkflowSettings> & {
    stationVisibility?: {
      noodle?: boolean;
      packagingStationCount?: number;
    };
    menuItems?: unknown;
    menuTags?: unknown;
  };

  const baseMenuIdSet = new Set(MENU_ITEMS.map((item) => item.id));
  const rawMenuItems = Array.isArray(candidate.menuItems) ? candidate.menuItems : defaults.menuItems;
  const normalizedMenuItems = rawMenuItems
    .filter((entry) => Boolean(entry) && typeof entry === 'object')
    .map((entry, index) => {
      const source = entry as Partial<WorkflowMenuItem>;
      const category = WORKFLOW_MENU_CATEGORIES.includes(source.category as MenuCategory)
        ? (source.category as MenuCategory)
        : 'side';
      const name = typeof source.name === 'string' && source.name.trim()
        ? source.name.trim().slice(0, 40)
        : `新品項 ${index + 1}`;
      const rawPrice = Number(source.price);
      const price = Number.isFinite(rawPrice) ? Math.max(0, Math.round(rawPrice * 10) / 10) : 0;
      const id = typeof source.id === 'string' && source.id.trim()
        ? source.id.trim()
        : `menu-${index + 1}`;
      const tags = sanitizeTagArray(source.tags);
      const defaultPrep = getDefaultPrepConfigForMenuItem({ id, category });
      const prepStation = sanitizePrepStation(
        source.prepStation ?? defaultPrep.prepStation,
        category,
        defaultPrep.prepStation,
      );
      return {
        id,
        category,
        name,
        price,
        unit: sanitizeMenuUnit(source.unit),
        optionType: sanitizeMenuOptionType(source.optionType),
        description: typeof source.description === 'string' ? source.description : undefined,
        fixedDumplingCount: typeof source.fixedDumplingCount === 'number' ? source.fixedDumplingCount : undefined,
        baseDumplingPrice: typeof source.baseDumplingPrice === 'number' ? source.baseDumplingPrice : undefined,
        soldOut: Boolean(source.soldOut),
        custom: typeof source.custom === 'boolean' ? source.custom : !baseMenuIdSet.has(id),
        tags: tags.length > 0 ? tags : [CATEGORY_TAG_BY_MENU_CATEGORY[category]],
        dependencyMode: sanitizeDependencyMode(source.dependencyMode),
        dependencyItemIds: sanitizeDependencyItemIds(source.dependencyItemIds),
        prepStation,
        prepSeconds: sanitizePrepSeconds(source.prepSeconds, defaultPrep.prepSeconds, prepStation),
      } satisfies WorkflowMenuItem;
    });
  const dedupedMenuItems: WorkflowMenuItem[] = [];
  const seenMenuIds = new Set<string>();
  normalizedMenuItems.forEach((item, index) => {
    let nextId = item.id;
    while (seenMenuIds.has(nextId)) {
      nextId = `${item.id}-${index + 1}`;
    }
    seenMenuIds.add(nextId);
    dedupedMenuItems.push({ ...item, id: nextId });
  });
  if (dedupedMenuItems.length === 0) {
    dedupedMenuItems.push(...defaults.menuItems);
  }
  const menuIdSet = new Set(dedupedMenuItems.map((item) => item.id));
  const normalizedDependencyMenuItems: WorkflowMenuItem[] = dedupedMenuItems.map((item) => ({
    ...item,
    dependencyMode: 'all',
    dependencyItemIds: sanitizeDependencyItemIds(item.dependencyItemIds).filter(
      (dependencyId) => dependencyId !== item.id && menuIdSet.has(dependencyId),
    ),
  } satisfies WorkflowMenuItem));
  const menuTagsSeed = sanitizeTagArray(candidate.menuTags);
  normalizedDependencyMenuItems.forEach((item) => {
    item.tags.forEach((tag) => menuTagsSeed.push(tag));
  });
  Object.values(CATEGORY_TAG_BY_MENU_CATEGORY).forEach((tag) => menuTagsSeed.push(tag));
  const menuTags = sanitizeTagArray(menuTagsSeed);

  if (Array.isArray(candidate.productionStations) || Array.isArray(candidate.packagingStations)) {
    return {
      productionStations: sanitizeStationList(
        candidate.productionStations,
        defaults.productionStations,
        'production',
      ),
      packagingStations: sanitizeStationList(
        candidate.packagingStations,
        defaults.packagingStations,
        'packaging',
      ),
      menuItems: normalizedDependencyMenuItems,
      menuTags,
    };
  }

  const legacyNoodleEnabled = candidate.stationVisibility?.noodle !== false;
  const legacyPackagingCount = candidate.stationVisibility?.packagingStationCount === 2 ? 2 : 1;
  const migratedProduction = defaults.productionStations.map((station) =>
    station.id === 'production-noodle' ? { ...station, enabled: legacyNoodleEnabled } : station,
  );
  const migratedPackaging = [
    defaults.packagingStations[0],
    ...(legacyPackagingCount === 2
      ? [{
        ...defaults.packagingStations[0],
        id: 'packaging-b',
        name: '包裝 B',
      }]
      : []),
  ];
  return {
    productionStations: migratedProduction,
    packagingStations: migratedPackaging,
    menuItems: normalizedDependencyMenuItems,
    menuTags,
  };
};

const PACKAGING_STATUS_META: Record<PackagingStatus, {
  label: string;
  chipClass: string;
  panelClass: string;
}> = {
  waiting_pickup: {
    label: '待取餐',
    chipClass: 'border-amber-200 bg-amber-50 text-amber-700',
    panelClass: 'border-amber-200 bg-amber-50/70',
  },
  served: {
    label: '已出餐',
    chipClass: 'border-slate-300 bg-slate-100 text-slate-700',
    panelClass: 'border-slate-300 bg-slate-100/70',
  },
};

const HEATED_SIDE_MENU_IDS = new Set<string>([
  'side-golden-tofu',
  'side-blanched-vegetable',
  'side-braised-radish',
  'side-ribs',
]);

const createInitialFryStations = (): Record<FryStationId, FryStationState> => ({
  griddle_a: {
    id: 'griddle_a',
    label: '煎台 A',
    capacity: 42,
    frySeconds: FRY_BATCH_SECONDS,
    lockedBatch: null,
  },
  griddle_b: {
    id: 'griddle_b',
    label: '煎台 B',
    capacity: 30,
    frySeconds: FRY_BATCH_SECONDS,
    lockedBatch: null,
  },
});

const createId = () =>
  crypto.randomUUID?.() ?? `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createWorkflowStationDraft = (
  scope: 'production' | 'packaging',
  index: number,
  preferredModule: ProductionSection = 'griddle',
  forcedId?: string,
): WorkflowStation => ({
  id: forcedId ?? `${scope}-${createId()}`,
  name: scope === 'production'
    ? `${PRODUCTION_MODULE_LABEL[preferredModule]} ${index}`
    : `包裝站 ${index}`,
  enabled: true,
  module: scope === 'production' ? preferredModule : 'packaging',
  serviceMode: 'any',
  matchMode: 'any',
  categoryRules: scope === 'production'
    ? getCategoryRulesByProductionModule(preferredModule)
    : createCategoryRules(),
  tagRules: [],
});

const createBoxSelection = (
  optionId: string,
  type: BoxOrderCategory,
  forcedId?: string,
): BoxSelection => ({
  id: forcedId ?? `box-${createId()}`,
  optionId,
  type,
  items: [],
});

const createInitialBoxState = () => ({
  boxes: {
    potsticker: [],
    dumpling: [],
  } as Record<BoxOrderCategory, BoxSelection[]>,
  active: {
    potsticker: '',
    dumpling: '',
  } as Record<BoxOrderCategory, string>,
});

const getBoxUsage = (box: BoxSelection) =>
  box.items.reduce((sum, item) => sum + item.count, 0);

const normalizePotstickerFlavorName = (name: string) =>
  name.replace(/鍋貼/g, '').replace(/\s+/g, ' ').trim() || name;
const normalizeDumplingFlavorName = (name: string) =>
  name.replace(/水餃/g, '').replace(/\s+/g, ' ').trim() || name;

const INGEST_NAME_OVERRIDES: Array<{ source: string; target: string }> = [
  { source: '咖哩鍋貼', target: '咖哩雞肉鍋貼' },
  { source: '韓式泡菜鍋貼', target: '韓式辣味鍋貼' },
  { source: '玉米濃湯', target: '玉米湯' },
  { source: '貢丸湯', target: '旗魚花枝丸湯' },
  { source: '豆漿', target: '香濃豆漿' },
  { source: '紅茶', target: '真傳紅茶' },
  { source: '炸豆腐', target: '黃金豆腐' },
];

const normalizeIngestMatchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[()（）[\]【】,，.。:：;；/\\|_+\-*]+/g, '')
    .replace(/濃湯/g, '湯');

const applyIngestNameOverrides = (value: string) => {
  let next = value;
  INGEST_NAME_OVERRIDES.forEach((rule) => {
    if (next.includes(rule.source)) {
      next = next.split(rule.source).join(rule.target);
    }
  });
  return next;
};

const toIngestBigrams = (value: string) => {
  const token = normalizeIngestMatchText(value);
  const set = new Set<string>();
  if (!token) return set;
  if (token.length < 2) {
    set.add(token);
    return set;
  }
  for (let index = 0; index < token.length - 1; index += 1) {
    set.add(token.slice(index, index + 2));
  }
  return set;
};

const scoreIngestNameCandidate = (candidate: string, target: string) => {
  const candidateToken = normalizeIngestMatchText(applyIngestNameOverrides(candidate));
  const targetToken = normalizeIngestMatchText(target);
  if (!candidateToken || !targetToken) return 0;
  if (candidateToken === targetToken) return 1;

  let score = 0;
  if (targetToken.includes(candidateToken) || candidateToken.includes(targetToken)) {
    const shorter = Math.max(1, Math.min(candidateToken.length, targetToken.length));
    const longer = Math.max(candidateToken.length, targetToken.length);
    score = Math.max(score, 0.72 + (shorter / longer) * 0.2);
  }

  const candidateGrams = toIngestBigrams(candidateToken);
  const targetGrams = toIngestBigrams(targetToken);
  if (candidateGrams.size === 0 || targetGrams.size === 0) return score;

  let intersection = 0;
  candidateGrams.forEach((token) => {
    if (targetGrams.has(token)) intersection += 1;
  });
  const union = candidateGrams.size + targetGrams.size - intersection;
  if (union <= 0) return score;
  const jaccard = intersection / union;
  return Math.max(score, jaccard);
};

const stationAccentClass = (stationLabel: string) => {
  if (stationLabel.includes('A')) {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  if (stationLabel.includes('B')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
};

const waterServiceModeStripeClass = (mode: ServiceMode) =>
  mode === 'dine_in' ? 'border-l-emerald-500' : 'border-l-amber-500';

const waterServiceModeBadgeClass = (mode: ServiceMode) =>
  mode === 'dine_in'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';

const waterServiceModeLabel = (mode: ServiceMode, lang: StationLanguage = 'zh-TW') => (mode === 'dine_in' ? pt('dine_in', lang) : pt('takeout', lang));

const actionButtonBase =
  'bafang-action inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:cursor-not-allowed disabled:opacity-50';
const railButtonBase =
  'bafang-rail-button inline-flex min-h-11 items-center justify-center rounded-none px-2 text-sm font-semibold transition-all duration-300 md:min-h-10 first:rounded-l-xl last:rounded-r-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/80 disabled:cursor-not-allowed disabled:opacity-45';

const cardClass =
  'bafang-surface-card bafang-glass overflow-visible rounded-3xl p-4 transition-[transform,box-shadow,border-color,background-color] duration-300 sm:p-5 lg:p-6 xl:p-7';

const getCategoryTag = (category: MenuCategory) => {
  switch (category) {
    case 'potsticker':
      return '鍋貼';
    case 'dumpling':
      return '水餃';
    case 'side':
      return '小菜';
    case 'soup_drink':
      return '湯飲';
    case 'soup_dumpling':
      return '湯餃';
    case 'noodle':
      return '麵類';
    default:
      return '';
  }
};

const createEmptyOrderCategoryFlags = (): Record<MenuCategory, boolean> =>
  WORKFLOW_MENU_CATEGORIES.reduce((acc, category) => {
    acc[category] = false;
    return acc;
  }, {} as Record<MenuCategory, boolean>);

const buildOrderCategoryFlags = (
  order: SubmittedOrder,
  itemMap: Map<string, WorkflowMenuItem>,
): Record<MenuCategory, boolean> => {
  const flags = createEmptyOrderCategoryFlags();
  order.boxRows.forEach((row) => {
    if (row.id.startsWith('potsticker-')) flags.potsticker = true;
    if (row.id.startsWith('dumpling-')) flags.dumpling = true;
  });
  order.cartLines.forEach((line) => {
    const category = itemMap.get(line.menuItemId)?.category;
    if (!category) return;
    flags[category] = true;
  });
  return flags;
};

const buildOrderTagSet = (
  order: SubmittedOrder,
  itemMap: Map<string, WorkflowMenuItem>,
  itemNameCategoryMap: Map<string, WorkflowMenuItem>,
): Set<string> => {
  const tagSet = new Set<string>();
  order.cartLines.forEach((line) => {
    const item = itemMap.get(line.menuItemId);
    if (!item) return;
    item.tags.forEach((tag) => tagSet.add(tag));
  });
  order.boxRows.forEach((row) => {
    const rowCategory = row.id.startsWith('potsticker-')
      ? 'potsticker'
      : row.id.startsWith('dumpling-')
        ? 'dumpling'
        : null;
    if (!rowCategory) return;
    tagSet.add(CATEGORY_TAG_BY_MENU_CATEGORY[rowCategory]);
    row.items.forEach((item) => {
      const lookupKey = `${rowCategory}:${item.name}`.toLowerCase();
      const menuItem = itemNameCategoryMap.get(lookupKey);
      if (!menuItem) return;
      menuItem.tags.forEach((tag) => tagSet.add(tag));
    });
  });
  return tagSet;
};

const filterMatchesOrder = (
  station: WorkflowStation,
  flags: Record<MenuCategory, boolean>,
  tags: Set<string>,
  serviceMode: ServiceMode,
): boolean => {
  if (!station.enabled) return false;
  if (station.serviceMode !== 'any' && station.serviceMode !== serviceMode) return false;

  const positiveCategories = WORKFLOW_MENU_CATEGORIES.filter(
    (category) => station.categoryRules[category] === 'yes',
  );
  const negativeCategories = WORKFLOW_MENU_CATEGORIES.filter(
    (category) => station.categoryRules[category] === 'no',
  );
  const positiveTags = station.tagRules
    .filter((rule) => rule.mode === 'yes')
    .map((rule) => rule.tag);
  const negativeTags = station.tagRules
    .filter((rule) => rule.mode === 'no')
    .map((rule) => rule.tag);
  const blocked = negativeCategories.some((category) => flags[category]) ||
    negativeTags.some((tag) => tags.has(tag));
  if (blocked) return false;

  const positivePredicates = [
    ...positiveCategories.map((category) => flags[category]),
    ...positiveTags.map((tag) => tags.has(tag)),
  ];
  if (positivePredicates.length === 0) return true;
  if (station.matchMode === 'all') {
    return positivePredicates.every(Boolean);
  }
  return positivePredicates.some(Boolean);
};

const getEffectivePackagingStations = (settings: WorkflowSettings): WorkflowStation[] => {
  const enabled = settings.packagingStations.filter((station) => station.enabled);
  if (enabled.length > 0) return enabled;
  if (settings.packagingStations.length > 0) return [settings.packagingStations[0]];
  return createDefaultPackagingStations();
};

const getInitialPackagingLaneId = (settings: WorkflowSettings): PackagingLaneId =>
  getEffectivePackagingStations(settings)[0]?.id ?? 'packaging-a';

type AppShellProps = {
  userId: string;
  authUser: AuthUser;
};

function AppShell({ userId, authUser }: AppShellProps) {
  const workflowSettingsStorageKey = withUserStorageScope(WORKFLOW_SETTINGS_STORAGE_KEY, userId);
  const tutorialStorageKey = withUserStorageScope(CUSTOMER_TUTORIAL_STORAGE_KEY, userId);
  const runtimeStorageKey = withUserStorageScope(USER_RUNTIME_STORAGE_KEY, userId);
  const featureFlagsStorageKey = withUserStorageScope(FEATURE_FLAGS_STORAGE_KEY, userId);
  const runtimeSnapshotRef = useRef<Partial<UserRuntimeSnapshot> | null>(null);
  if (runtimeSnapshotRef.current === null) {
    runtimeSnapshotRef.current = readUserRuntimeSnapshot(runtimeStorageKey);
  }
  const runtimeSnapshot = runtimeSnapshotRef.current;

  const initialBoxSetup = runtimeSnapshot?.boxState && runtimeSnapshot?.activeBoxState
    ? {
      boxes: runtimeSnapshot.boxState,
      active: runtimeSnapshot.activeBoxState,
    }
    : createInitialBoxState();
  const userPerspectivePolicy = useMemo(
    () => resolveUserPerspectivePolicy(authUser),
    [authUser.settings],
  );

  const [activePerspective, setActivePerspective] = useState<AppPerspective>(
    () => {
      const snapshotPerspective = normalizePerspective(runtimeSnapshot?.activePerspective);
      if (
        snapshotPerspective &&
        userPerspectivePolicy.allowedPerspectives.includes(snapshotPerspective)
      ) {
        return snapshotPerspective;
      }
      return userPerspectivePolicy.defaultPerspective;
    },
  );
  const [workspaceFullscreen, setWorkspaceFullscreen] = useState(false);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings>(() => {
    if (typeof window === 'undefined') return createDefaultWorkflowSettings();
    try {
      const raw = window.localStorage.getItem(workflowSettingsStorageKey);
      if (!raw) return createDefaultWorkflowSettings();
      return sanitizeWorkflowSettings(JSON.parse(raw));
    } catch {
      return createDefaultWorkflowSettings();
    }
  });
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowSettings>(() => workflowSettings);
  const [settingsSaveNotice, setSettingsSaveNotice] = useState<SettingsSaveNotice | null>(null);
  const [settingsLeaveNotice, setSettingsLeaveNotice] = useState<{ stamp: number; phase: 'show' | 'hide' } | null>(null);
  const [featureFlags] = useState<FeatureFlags>(() => readFeatureFlags(featureFlagsStorageKey));
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>('stations');
  const [settingsMenuActiveTag, setSettingsMenuActiveTag] = useState<string>('all');
  const [settingsMenuExpandedItemId, setSettingsMenuExpandedItemId] = useState<string | null>(null);
  const [settingsTagLibraryExpanded, setSettingsTagLibraryExpanded] = useState(false);
  const [settingsNewItemExpanded, setSettingsNewItemExpanded] = useState(false);
  const [settingsNewTagInput, setSettingsNewTagInput] = useState('');
  const [settingsStationHighlight, setSettingsStationHighlight] = useState<{
    scope: 'production' | 'packaging';
    stationId: string;
    phase: 'show' | 'hide';
  } | null>(null);
  const [settingsExpandedStationKeys, setSettingsExpandedStationKeys] = useState<string[]>([]);
  const settingsStationCardRef = useRef<Record<string, HTMLElement | null>>({});
  const settingsPendingStationFocusRef = useRef<{
    scope: 'production' | 'packaging';
    stationId: string;
  } | null>(null);
  const [settingsNewMenuItem, setSettingsNewMenuItem] = useState<{
    name: string;
    category: MenuCategory;
    price: string;
    unit: WorkflowMenuItem['unit'];
    optionType: MenuOptionType;
    tags: string;
    prepStation: PrepStation;
    prepSeconds: string;
  }>({
    name: '',
    category: 'side',
    price: '',
    unit: '份',
    optionType: 'none',
    tags: '',
    prepStation: 'none',
    prepSeconds: '0',
  });

  // --- Hardware module toggles ---
  const [hwModules, setHwModules] = useState<HardwareModuleConfig>(() => {
    try {
      const raw = window.localStorage.getItem(HW_MODULES_STORAGE_KEY);
      if (!raw) return DEFAULT_HW_MODULES;
      return { ...DEFAULT_HW_MODULES, ...JSON.parse(raw) } as HardwareModuleConfig;
    } catch {
      return DEFAULT_HW_MODULES;
    }
  });
  const toggleHwModule = (id: HardwareModuleId) => {
    const next = { ...hwModules, [id]: !hwModules[id] };
    setHwModules(next);
    try { window.localStorage.setItem(HW_MODULES_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // --- API Hub state ---
  const [apiHubDevices, setApiHubDevices] = useState<ApiHubDevice[]>(() => {
    try {
      const raw = window.localStorage.getItem(API_HUB_STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as ApiHubDevice[];
    } catch {
      return [];
    }
  });
  const [apiHubExpandedId, setApiHubExpandedId] = useState<string | null>(null);
  const [apiHubTestingId, setApiHubTestingId] = useState<string | null>(null);

  const saveApiHubDevices = (devices: ApiHubDevice[]) => {
    setApiHubDevices(devices);
    try { window.localStorage.setItem(API_HUB_STORAGE_KEY, JSON.stringify(devices)); } catch { /* ignore */ }
  };
  const addApiHubDevice = () => {
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newDevice: ApiHubDevice = {
      id, name: '', deviceType: 'receipt_printer', endpointUrl: '',
      authMethod: 'none', authSecret: '', enabled: true, note: '',
      lastTestStatus: 'unknown', lastTestAt: null,
    };
    const next = [...apiHubDevices, newDevice];
    saveApiHubDevices(next);
    setApiHubExpandedId(id);
  };
  const removeApiHubDevice = (id: string) => {
    saveApiHubDevices(apiHubDevices.filter((d) => d.id !== id));
    if (apiHubExpandedId === id) setApiHubExpandedId(null);
  };
  const updateApiHubDevice = (id: string, patch: Partial<ApiHubDevice>) => {
    saveApiHubDevices(apiHubDevices.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };
  const testApiHubDevice = async (id: string) => {
    const device = apiHubDevices.find((d) => d.id === id);
    if (!device || !device.endpointUrl) return;
    setApiHubTestingId(id);
    try {
      const headers: Record<string, string> = {};
      if (device.authMethod === 'api_key') headers['X-API-Key'] = device.authSecret;
      if (device.authMethod === 'bearer_token') headers['Authorization'] = `Bearer ${device.authSecret}`;
      await fetch(device.endpointUrl, { method: 'HEAD', headers, mode: 'no-cors' });
      updateApiHubDevice(id, { lastTestStatus: 'ok', lastTestAt: Date.now() });
    } catch {
      updateApiHubDevice(id, { lastTestStatus: 'error', lastTestAt: Date.now() });
    } finally {
      setApiHubTestingId(null);
    }
  };

  const [customerPage, setCustomerPage] = useState<CustomerPage>(() => runtimeSnapshot?.customerPage ?? 'landing');
  const [serviceMode, setServiceMode] = useState<ServiceMode | null>(() => runtimeSnapshot?.serviceMode ?? null);
  const [customerTutorialPreference, setCustomerTutorialPreference] = useState<CustomerTutorialPreference>(
    () => readCustomerTutorialPreference(tutorialStorageKey),
  );
  const [customerTutorialActive, setCustomerTutorialActive] = useState(false);
  const [customerTutorialStep, setCustomerTutorialStep] = useState<CustomerTutorialStep>('box_add');
  const [tutorialSpotlightRect, setTutorialSpotlightRect] = useState<TutorialSpotlightRect | null>(null);
  const tutorialTargetRefs = useRef<Record<string, HTMLElement | null>>({});
  const tutorialStepTimerRef = useRef<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<MenuCategory>(
    () => runtimeSnapshot?.activeCategory ?? 'potsticker',
  );
  const [cart, setCart] = useState<CartLine[]>(() => runtimeSnapshot?.cart ?? []);
  const cartSectionRef = useRef<HTMLElement | null>(null);
  const boxSectionRef = useRef<HTMLDivElement | null>(null);
  const incrementPressDelayRef = useRef<number | null>(null);
  const incrementPressRepeatRef = useRef<number | null>(null);
  const dockAddButtonTimerRef = useRef<number | null>(null);
  const suppressNextIncrementClickRef = useRef<string | null>(null);
  const fastTapTrackerRef = useRef<{ key: string; count: number; lastAt: number }>({
    key: '',
    count: 0,
    lastAt: 0,
  });

  const [expandedConfigItemId, setExpandedConfigItemId] = useState<string | null>(null);
  const [configTofuSauce, setConfigTofuSauce] = useState<TofuSauce>('麻醬');
  const [configNoodleStaple, setConfigNoodleStaple] = useState<NoodleStaple>('麵條');
  const [configSoupFlavorId, setConfigSoupFlavorId] = useState<string>(DUMPLING_FLAVORS[0]?.id ?? '');
  const [configQuantity, setConfigQuantity] = useState<number>(1);
  const [configNote, setConfigNote] = useState<string>('');
  const [cartOrderNote, setCartOrderNote] = useState<string>(() => runtimeSnapshot?.cartOrderNote ?? '');
  const [recentlyAdded, setRecentlyAdded] = useState<AddedFeedback | null>(null);
  const [boxReminder, setBoxReminder] = useState<BoxReminder | null>(null);
  const [fastTapHint, setFastTapHint] = useState<FastTapHint | null>(null);
  const [dockingAddButton, setDockingAddButton] = useState<BoxOrderCategory | null>(null);
  const [productionOrders, setProductionOrders] = useState<SubmittedOrder[]>(() => runtimeSnapshot?.productionOrders ?? []);
  const [packagingOrders, setPackagingOrders] = useState<SubmittedOrder[]>(() => runtimeSnapshot?.packagingOrders ?? []);
  const [packagingStatusByOrderId, setPackagingStatusByOrderId] = useState<Record<string, PackagingStatus>>(
    () => runtimeSnapshot?.packagingStatusByOrderId ?? {},
  );
  const [packagingItemStatusOverrides, setPackagingItemStatusOverrides] = useState<
    Record<string, Record<string, PackagingItemTrackStatus>>
  >(() => runtimeSnapshot?.packagingItemStatusOverrides ?? {});
  const [packagingPinnedOrderIds, setPackagingPinnedOrderIds] = useState<string[]>(
    () => runtimeSnapshot?.packagingPinnedOrderIds ?? [],
  );
  const [packagingDraggingOrderId, setPackagingDraggingOrderId] = useState<string | null>(null);
  const [packagingDropActive, setPackagingDropActive] = useState(false);
  const [packagingQueuedTapArmedKey, setPackagingQueuedTapArmedKey] = useState<string | null>(null);
  const packagingQueuedTapTimerRef = useRef<number | null>(null);
  const [packagingSearchKeyword, setPackagingSearchKeyword] = useState('');
  const [packagingTopQueueSize, setPackagingTopQueueSize] = useState<'md' | 'lg'>(
    () => runtimeSnapshot?.packagingTopQueueSize ?? 'lg',
  );
  const [packagingTopQueueLimit, setPackagingTopQueueLimit] = useState<number>(
    () => runtimeSnapshot?.packagingTopQueueLimit ?? 3,
  );
  const [packagingTopQueueLimitInput, setPackagingTopQueueLimitInput] = useState<string>(
    () => runtimeSnapshot?.packagingTopQueueLimitInput ?? '3',
  );
  const [activePackagingLane, setActivePackagingLane] = useState<PackagingLaneId>(
    () => runtimeSnapshot?.activePackagingLane ?? getInitialPackagingLaneId(workflowSettings),
  );
  const packagingModeSeededLaneRef = useRef<string | null>(null);
  const [expandedWorkflowOrderId, setExpandedWorkflowOrderId] = useState<string | null>(null);
  const [activeProductionStationIndexBySection, setActiveProductionStationIndexBySection] = useState<
    Record<ProductionSection, number>
  >(() => runtimeSnapshot?.activeProductionStationIndexBySection ?? {
    griddle: 0,
    dumpling: 0,
    noodle: 0,
  });
  const [archivedOrderIds, setArchivedOrderIds] = useState<string[]>(
    () => runtimeSnapshot?.archivedOrderIds ?? [],
  );
  const [archivingOrderIds, setArchivingOrderIds] = useState<string[]>([]);
  const [workflowOrderNotes, setWorkflowOrderNotes] = useState<Record<string, string>>(
    () => runtimeSnapshot?.workflowOrderNotes ?? {},
  );
  const archiveOrderTimerRef = useRef<Record<string, number>>({});
  const [productionSection, setProductionSection] = useState<ProductionSection>(
    () => runtimeSnapshot?.productionSection ?? 'griddle',
  );
  const [fryStations, setFryStations] = useState<Record<FryStationId, FryStationState>>(
    () => runtimeSnapshot?.fryStations ?? createInitialFryStations(),
  );
  const [showFryOrderDetails, setShowFryOrderDetails] = useState<Record<FryStationId, boolean>>({
    griddle_a: false,
    griddle_b: false,
  });
  const [activeFryPreviewPanel, setActiveFryPreviewPanel] = useState<FryPreviewPanel | null>(null);
  const [fryRecalcVersion, setFryRecalcVersion] = useState(0);
  const [splitOrderIds, setSplitOrderIds] = useState<string[]>(() => runtimeSnapshot?.splitOrderIds ?? []);
  const [fryTimerNow, setFryTimerNow] = useState<number>(Date.now());
  const [friedEntryIds, setFriedEntryIds] = useState<string[]>(() => runtimeSnapshot?.friedEntryIds ?? []);
  const [friedPotstickerPieces, setFriedPotstickerPieces] = useState<number>(
    () => runtimeSnapshot?.friedPotstickerPieces ?? 0,
  );
  const [waterLadleCountByStationId, setWaterLadleCountByStationId] = useState<Record<string, number>>(
    () => runtimeSnapshot?.waterLadleCountByStationId ?? {},
  );
  const [waterTaskProgress, setWaterTaskProgress] = useState<Record<string, WaterTaskProgress>>(
    () => runtimeSnapshot?.waterTaskProgress ?? {},
  );
  const [waterUnlockedTaskIds, setWaterUnlockedTaskIds] = useState<string[]>(
    () => runtimeSnapshot?.waterUnlockedTaskIds ?? [],
  );
  const [selectedWaterTransferTaskId, setSelectedWaterTransferTaskId] = useState<string | null>(null);
  const [waterTransferFx, setWaterTransferFx] = useState<WaterTransferFx | null>(null);
  const [waterForceFinishPromptTaskId, setWaterForceFinishPromptTaskId] = useState<string | null>(null);
  const waterFinishTapTrackerRef = useRef<{ taskId: string; count: number; lastAt: number }>({
    taskId: '',
    count: 0,
    lastAt: 0,
  });
  const [waterDumplingTargetCount, setWaterDumplingTargetCount] = useState<number>(
    () => runtimeSnapshot?.waterDumplingTargetCount ?? 40,
  );
  const [waterDumplingCapturedTaskIds, setWaterDumplingCapturedTaskIds] = useState<string[]>(
    () => runtimeSnapshot?.waterDumplingCapturedTaskIds ?? [],
  );
  const [showWaterCompletedPanelBySection, setShowWaterCompletedPanelBySection] = useState<{
    dumpling: boolean;
    noodle: boolean;
  }>({
    dumpling: false,
    noodle: false,
  });
  const [orderSequence, setOrderSequence] = useState<number>(() => runtimeSnapshot?.orderSequence ?? 1);
  const [submitNotice, setSubmitNotice] = useState<SubmitNotice | null>(null);
  const [seedOrderInput, setSeedOrderInput] = useState<string>('6');
  const [seedOrdersNotice, setSeedOrdersNotice] = useState<SeedOrdersNotice | null>(null);
  const [commandHubPendingReviewOrders, setCommandHubPendingReviewOrders] = useState<OrdersReviewListItem[]>([]);
  const [commandHubTrackingOrders, setCommandHubTrackingOrders] = useState<OrdersReviewListItem[]>([]);
  const [commandHubLoadError, setCommandHubLoadError] = useState<string | null>(null);
  const [commandHubLoading, setCommandHubLoading] = useState(false);
  const [commandHubLastSyncedAt, setCommandHubLastSyncedAt] = useState<number | null>(null);
  const [commandHubRefreshToken, setCommandHubRefreshToken] = useState(0);
  const [reviewAlertToast, setReviewAlertToast] = useState<ReviewAlertToast | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [ingestDispatchNotices, setIngestDispatchNotices] = useState<IngestDispatchNotice[]>([]);
  const autoDispatchSyncingRef = useRef(false);
  const autoDispatchedReviewOrderIdsRef = useRef<Set<string>>(new Set());
  const reviewPendingCountRef = useRef(0);
  const reviewPendingCountReadyRef = useRef(false);
  const workflowResetVersionRef = useRef<number | null>(null);

  const [boxState, setBoxState] = useState<Record<BoxOrderCategory, BoxSelection[]>>(() => initialBoxSetup.boxes);
  const [activeBoxState, setActiveBoxState] = useState<Record<BoxOrderCategory, string>>(
    () => initialBoxSetup.active,
  );
  const isProductionStationMode = userPerspectivePolicy.workMode === 'production_station';
  const isPackagingStationMode = userPerspectivePolicy.workMode === 'packaging_station';
  const isCommandHubMode = userPerspectivePolicy.workMode === 'command_hub';
  const allowedPerspectiveSet = useMemo(
    () => new Set<AppPerspective>(userPerspectivePolicy.allowedPerspectives),
    [userPerspectivePolicy.allowedPerspectives],
  );
  const isPerspectiveAllowed = (perspective: AppPerspective) => allowedPerspectiveSet.has(perspective);
  const canActivatePerspective = (perspective: AppPerspective) =>
    isPerspectiveAllowed(perspective) && (
      !userPerspectivePolicy.lockedPerspective ||
      userPerspectivePolicy.lockedPerspective === perspective
    );
  const activatePerspective = (perspective: AppPerspective) => {
    if (!canActivatePerspective(perspective)) return false;
    setActivePerspective(perspective);
    return true;
  };

  const toggleWorkspaceFullscreen = async () => {
    if (typeof document === 'undefined') {
      setWorkspaceFullscreen((prev) => !prev);
      return;
    }
    const root = document.documentElement;
    const next = !workspaceFullscreen;
    if (next) {
      try {
        if (!document.fullscreenElement && root.requestFullscreen) {
          await root.requestFullscreen();
        }
      } catch {
        // ignore browser fullscreen failures and keep UI-only fullscreen mode
      }
      setWorkspaceFullscreen(true);
      return;
    }

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore browser fullscreen failures and keep UI-only fullscreen mode
    }
    setWorkspaceFullscreen(false);
  };

  const customerTutorialEnabled = featureFlags.customerTutorial && customerTutorialPreference.enabled;
  const customerTutorialCompleted = customerTutorialPreference.completed;
  const setTutorialTargetRef = (key: string, node: HTMLElement | null) => {
    tutorialTargetRefs.current[key] = node;
  };
  const clearTutorialStepTimer = () => {
    if (tutorialStepTimerRef.current === null) return;
    window.clearTimeout(tutorialStepTimerRef.current);
    tutorialStepTimerRef.current = null;
  };

  const isBoxCategory = activeCategory === 'potsticker' || activeCategory === 'dumpling';
  const activeBoxCategory = isBoxCategory ? activeCategory : null;
  const menuItems = useMemo(() => workflowSettings.menuItems, [workflowSettings.menuItems]);
  const itemMap = useMemo(() => {
    const map = new Map<string, WorkflowMenuItem>();
    menuItems.forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [menuItems]);
  const menuAvailabilityById = useMemo(() => {
    const base = new Map<string, MenuAvailabilityState>();

    const resolve = (itemId: string, stack: Set<string>): MenuAvailabilityState => {
      const cached = base.get(itemId);
      if (cached) return cached;
      const item = itemMap.get(itemId);
      if (!item) {
        return {
          directSoldOut: true,
          dependencySoldOut: true,
          unavailable: true,
          blockingDependencyIds: [],
        };
      }
      if (stack.has(itemId)) {
        const cycleState: MenuAvailabilityState = {
          directSoldOut: item.soldOut,
          dependencySoldOut: true,
          unavailable: true,
          blockingDependencyIds: [...item.dependencyItemIds],
        };
        base.set(itemId, cycleState);
        return cycleState;
      }

      stack.add(itemId);
      const blockingDependencyIds: string[] = [];
      item.dependencyItemIds.forEach((dependencyId) => {
        const dependencyItem = itemMap.get(dependencyId);
        if (!dependencyItem) {
          blockingDependencyIds.push(dependencyId);
          return;
        }
        const dependencyState = resolve(dependencyId, stack);
        if (dependencyState.unavailable) {
          blockingDependencyIds.push(dependencyId);
        }
      });
      stack.delete(itemId);

      const dependencySoldOut = blockingDependencyIds.length > 0;
      const state: MenuAvailabilityState = {
        directSoldOut: item.soldOut,
        dependencySoldOut,
        unavailable: item.soldOut || dependencySoldOut,
        blockingDependencyIds,
      };
      base.set(itemId, state);
      return state;
    };

    menuItems.forEach((item) => {
      resolve(item.id, new Set<string>());
    });

    const hasSellableDumplingFlavor = menuItems.some((item) => {
      if (item.category !== 'dumpling' || item.unit !== '顆') return false;
      return !(base.get(item.id)?.unavailable ?? true);
    });

    const next = new Map<string, MenuAvailabilityState>();
    menuItems.forEach((item) => {
      const baseState = base.get(item.id) ?? {
        directSoldOut: true,
        dependencySoldOut: true,
        unavailable: true,
        blockingDependencyIds: [],
      };
      const dependsOnDumplingFlavorSupply =
        item.category === 'soup_dumpling' && item.optionType === 'soup_dumpling_flavor';
      const dependencySoldOut = baseState.dependencySoldOut || (
        dependsOnDumplingFlavorSupply && !hasSellableDumplingFlavor
      );
      next.set(item.id, {
        ...baseState,
        dependencySoldOut,
        unavailable: baseState.directSoldOut || dependencySoldOut,
      });
    });

    return next;
  }, [itemMap, menuItems]);
  const availableMenuItems = useMemo(
    () => menuItems.filter((item) => !(menuAvailabilityById.get(item.id)?.unavailable ?? true)),
    [menuAvailabilityById, menuItems],
  );
  const dumplingFlavorOptions = useMemo(
    () =>
      menuItems
        .filter((item) => item.category === 'dumpling' && item.unit === '顆')
        .map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          soldOut: menuAvailabilityById.get(item.id)?.unavailable ?? true,
        })),
    [menuAvailabilityById, menuItems],
  );
  const availableDumplingFlavors = useMemo(
    () => dumplingFlavorOptions.filter((item) => !item.soldOut),
    [dumplingFlavorOptions],
  );
  const itemNameCategoryMap = useMemo(() => {
    const map = new Map<string, WorkflowMenuItem>();
    menuItems.forEach((item) => {
      const key = `${item.category}:${item.name}`.toLowerCase();
      if (!map.has(key)) {
        map.set(key, item);
      }
    });
    return map;
  }, [menuItems]);
  const effectivePackagingStations = useMemo(
    () => getEffectivePackagingStations(workflowSettings),
    [workflowSettings],
  );
  const packagingStationMetaById = useMemo(() => {
    const map = new Map<string, { station: WorkflowStation; index: number }>();
    effectivePackagingStations.forEach((station, index) => {
      map.set(station.id, { station, index });
    });
    return map;
  }, [effectivePackagingStations]);
  const productionStationsByModule = useMemo<Record<ProductionSection, WorkflowStation[]>>(() => {
    const grouped: Record<ProductionSection, WorkflowStation[]> = {
      griddle: [],
      dumpling: [],
      noodle: [],
    };
    workflowSettings.productionStations
      .filter((station) => station.enabled)
      .forEach((station) => {
        const module = resolveProductionModuleFromStation(station);
        grouped[module].push(station);
      });
    return grouped;
  }, [workflowSettings.productionStations]);
  const activeProductionStationIdByModule = useMemo<Record<ProductionSection, string | null>>(
    () => ({
      griddle:
        productionStationsByModule.griddle[
          Math.min(
            activeProductionStationIndexBySection.griddle,
            Math.max(0, productionStationsByModule.griddle.length - 1),
          )
        ]?.id ?? null,
      dumpling:
        productionStationsByModule.dumpling[
          Math.min(
            activeProductionStationIndexBySection.dumpling,
            Math.max(0, productionStationsByModule.dumpling.length - 1),
          )
        ]?.id ?? null,
      noodle:
        productionStationsByModule.noodle[
          Math.min(
            activeProductionStationIndexBySection.noodle,
            Math.max(0, productionStationsByModule.noodle.length - 1),
          )
        ]?.id ?? null,
    }),
    [activeProductionStationIndexBySection, productionStationsByModule],
  );
  const productionOrderStationByModule = useMemo<Record<ProductionSection, Map<string, string>>>(() => {
    const assigned: Record<ProductionSection, Map<string, string>> = {
      griddle: new Map<string, string>(),
      dumpling: new Map<string, string>(),
      noodle: new Map<string, string>(),
    };
    const sortedOrders = [...productionOrders].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );

    const getOrderWorkload = (order: SubmittedOrder, module: ProductionSection) => {
      const boxWorkload = order.boxRows.reduce((sum, row) => {
        const rowCategory = row.id.startsWith('potsticker-')
          ? 'potsticker'
          : row.id.startsWith('dumpling-')
            ? 'dumpling'
            : null;
        if (!rowCategory) return sum;
        return sum + row.items.reduce((rowSum, rowItem) => {
          const lookupKey = `${rowCategory}:${rowItem.name}`.toLowerCase();
          const menuItem = itemNameCategoryMap.get(lookupKey);
          if (!menuItem || menuItem.prepStation !== module) return rowSum;
          return rowSum + rowItem.count;
        }, 0);
      }, 0);

      const lineWorkload = order.cartLines.reduce((sum, line) => {
        const item = itemMap.get(line.menuItemId);
        if (!item || item.prepStation !== module) return sum;
        if (item.category === 'soup_dumpling') {
          return sum + ((line.soupDumplingCount ?? item.fixedDumplingCount ?? 8) * line.quantity);
        }
        return sum + line.quantity;
      }, 0);
      return boxWorkload + lineWorkload;
    };

    (['griddle', 'dumpling', 'noodle'] as ProductionSection[]).forEach((module) => {
      const stations = productionStationsByModule[module];
      if (stations.length === 0) return;
      const loadByStation = new Map<string, number>(stations.map((station) => [station.id, 0]));
      sortedOrders.forEach((order) => {
        const workload = getOrderWorkload(order, module);
        if (workload <= 0) return;
        let pickedStation = stations[0];
        let pickedLoad = loadByStation.get(pickedStation.id) ?? 0;
        stations.slice(1).forEach((station) => {
          const stationLoad = loadByStation.get(station.id) ?? 0;
          if (stationLoad < pickedLoad) {
            pickedStation = station;
            pickedLoad = stationLoad;
          }
        });
        assigned[module].set(order.id, pickedStation.id);
        loadByStation.set(pickedStation.id, pickedLoad + workload);
      });
    });

    return assigned;
  }, [itemMap, itemNameCategoryMap, productionOrders, productionStationsByModule]);
  const noodleWorkflowEnabled = useMemo(
    () => productionStationsByModule.noodle.length > 0,
    [productionStationsByModule.noodle.length],
  );
  const griddleWorkflowEnabled = useMemo(
    () => productionStationsByModule.griddle.length > 0,
    [productionStationsByModule.griddle.length],
  );
  const dumplingWorkflowEnabled = useMemo(
    () => productionStationsByModule.dumpling.length > 0,
    [productionStationsByModule.dumpling.length],
  );
  const availableProductionSections = useMemo<ProductionSection[]>(() => {
    const sections: ProductionSection[] = [];
    if (griddleWorkflowEnabled) sections.push('griddle');
    if (dumplingWorkflowEnabled) sections.push('dumpling');
    if (noodleWorkflowEnabled) sections.push('noodle');
    return sections.length > 0 ? sections : ['griddle'];
  }, [dumplingWorkflowEnabled, griddleWorkflowEnabled, noodleWorkflowEnabled]);
  const lockedProductionStationTarget = useMemo<{
    section: ProductionSection;
    stationId: string;
    stationIndex: number;
  } | null>(() => {
    if (!isProductionStationMode) return null;

    const preferredStationId = userPerspectivePolicy.preferredProductionStationId;
    if (preferredStationId) {
      for (const section of PRODUCTION_MODULES) {
        const index = productionStationsByModule[section].findIndex((station) => station.id === preferredStationId);
        if (index >= 0) {
          const station = productionStationsByModule[section][index];
          if (!station) continue;
          return {
            section,
            stationId: station.id,
            stationIndex: index,
          };
        }
      }

      const stationAsSection = normalizeProductionSection(preferredStationId);
      if (stationAsSection) {
        const station = productionStationsByModule[stationAsSection][0];
        if (station) {
          return {
            section: stationAsSection,
            stationId: station.id,
            stationIndex: 0,
          };
        }
      }
    }

    const preferredSection = userPerspectivePolicy.preferredProductionSection;
    if (preferredSection) {
      const station = productionStationsByModule[preferredSection][0];
      if (station) {
        return {
          section: preferredSection,
          stationId: station.id,
          stationIndex: 0,
        };
      }
    }

    for (const section of PRODUCTION_MODULES) {
      const station = productionStationsByModule[section][0];
      if (station) {
        return {
          section,
          stationId: station.id,
          stationIndex: 0,
        };
      }
    }
    return null;
  }, [
    userPerspectivePolicy.preferredProductionSection,
    userPerspectivePolicy.preferredProductionStationId,
    isProductionStationMode,
    productionStationsByModule,
  ]);
  const preferredPackagingLaneId = useMemo(() => {
    if (!isPackagingStationMode) return null;
    const preferred = userPerspectivePolicy.preferredPackagingLaneId;
    if (preferred && packagingStationMetaById.has(preferred)) return preferred;
    return effectivePackagingStations[0]?.id ?? null;
  }, [
    userPerspectivePolicy.preferredPackagingLaneId,
    effectivePackagingStations,
    isPackagingStationMode,
    packagingStationMetaById,
  ]);
  const getPackagingLaneLabel = (laneId: PackagingLaneId) =>
    packagingStationMetaById.get(laneId)?.station.name ?? '包裝站';

  const clearIncrementPressTimers = () => {
    if (incrementPressDelayRef.current !== null) {
      window.clearTimeout(incrementPressDelayRef.current);
      incrementPressDelayRef.current = null;
    }
    if (incrementPressRepeatRef.current !== null) {
      window.clearInterval(incrementPressRepeatRef.current);
      incrementPressRepeatRef.current = null;
    }
  };

  useEffect(() => {
    if (availableDumplingFlavors.some((entry) => entry.id === configSoupFlavorId)) return;
    setConfigSoupFlavorId(availableDumplingFlavors[0]?.id ?? '');
  }, [availableDumplingFlavors, configSoupFlavorId]);

  useEffect(() => {
    setExpandedConfigItemId(null);
  }, [activeCategory]);

  useEffect(() => {
    setWorkflowDraft(workflowSettings);
  }, [workflowSettings]);

  useEffect(() => {
    if (settingsMenuActiveTag === 'all') return;
    if (workflowDraft.menuTags.includes(settingsMenuActiveTag)) return;
    setSettingsMenuActiveTag('all');
  }, [settingsMenuActiveTag, workflowDraft.menuTags]);

  useEffect(() => {
    if (!preferredPackagingLaneId) {
      packagingModeSeededLaneRef.current = null;
      return;
    }
    if (packagingModeSeededLaneRef.current === preferredPackagingLaneId) return;
    setActivePackagingLane(preferredPackagingLaneId);
    packagingModeSeededLaneRef.current = preferredPackagingLaneId;
  }, [preferredPackagingLaneId]);

  useEffect(() => {
    const laneIds = new Set(effectivePackagingStations.map((station) => station.id));
    if (!laneIds.has(activePackagingLane)) {
      setActivePackagingLane(getInitialPackagingLaneId(workflowSettings));
    }
  }, [activePackagingLane, effectivePackagingStations, workflowSettings]);

  useEffect(() => {
    if (availableProductionSections.includes(productionSection)) return;
    setProductionSection(availableProductionSections[0]);
  }, [availableProductionSections, productionSection]);

  useEffect(() => {
    if (!lockedProductionStationTarget) return;
    if (productionSection !== lockedProductionStationTarget.section) {
      setProductionSection(lockedProductionStationTarget.section);
    }
    setActiveProductionStationIndexBySection((prev) => {
      if (prev[lockedProductionStationTarget.section] === lockedProductionStationTarget.stationIndex) {
        return prev;
      }
      return {
        ...prev,
        [lockedProductionStationTarget.section]: lockedProductionStationTarget.stationIndex,
      };
    });
  }, [lockedProductionStationTarget, productionSection]);

  useEffect(() => {
    setActiveProductionStationIndexBySection((prev) => {
      const next: Record<ProductionSection, number> = {
        griddle: Math.min(
          prev.griddle,
          Math.max(0, productionStationsByModule.griddle.length - 1),
        ),
        dumpling: Math.min(
          prev.dumpling,
          Math.max(0, productionStationsByModule.dumpling.length - 1),
        ),
        noodle: Math.min(
          prev.noodle,
          Math.max(0, productionStationsByModule.noodle.length - 1),
        ),
      };
      if (
        next.griddle === prev.griddle &&
        next.dumpling === prev.dumpling &&
        next.noodle === prev.noodle
      ) {
        return prev;
      }
      return next;
    });
  }, [productionStationsByModule]);

  useEffect(() => {
    const target = settingsPendingStationFocusRef.current;
    if (!target) return;
    const node = settingsStationCardRef.current[`${target.scope}:${target.stationId}`];
    if (!node) return;
    settingsPendingStationFocusRef.current = null;
    window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [workflowDraft.packagingStations, workflowDraft.productionStations]);

  useEffect(() => {
    const validStationKeys = new Set<string>([
      ...workflowDraft.productionStations.map((station) => `production:${station.id}`),
      ...workflowDraft.packagingStations.map((station) => `packaging:${station.id}`),
    ]);
    setSettingsExpandedStationKeys((prev) => {
      const next = prev.filter((key) => validStationKeys.has(key));
      return next.length === prev.length ? prev : next;
    });
  }, [workflowDraft.packagingStations, workflowDraft.productionStations]);

  useEffect(() => {
    if (!settingsStationHighlight) return;
    const timer = window.setTimeout(() => {
      setSettingsStationHighlight((prev) => {
        if (!prev || prev.stationId !== settingsStationHighlight.stationId || prev.scope !== settingsStationHighlight.scope) {
          return prev;
        }
        if (prev.phase === 'show') return { ...prev, phase: 'hide' };
        return null;
      });
    }, settingsStationHighlight.phase === 'show' ? 1500 : 320);
    return () => {
      window.clearTimeout(timer);
    };
  }, [settingsStationHighlight]);

  useEffect(() => {
    if (!settingsSaveNotice) return;

    const timer = window.setTimeout(() => {
      setSettingsSaveNotice((prev) => {
        if (!prev || prev.stamp !== settingsSaveNotice.stamp) return prev;
        if (prev.phase === 'show') return { ...prev, phase: 'hide' };
        return null;
      });
    }, settingsSaveNotice.phase === 'show' ? 1800 : 380);

    return () => {
      window.clearTimeout(timer);
    };
  }, [settingsSaveNotice]);

  useEffect(() => {
    if (!settingsLeaveNotice) return;

    const timer = window.setTimeout(() => {
      setSettingsLeaveNotice((prev) => {
        if (!prev || prev.stamp !== settingsLeaveNotice.stamp) return prev;
        if (prev.phase === 'show') return { ...prev, phase: 'hide' };
        return null;
      });
    }, settingsLeaveNotice.phase === 'show' ? 1700 : 360);

    return () => {
      window.clearTimeout(timer);
    };
  }, [settingsLeaveNotice]);

  useEffect(() => {
    if (!recentlyAdded) return;

    const timer = window.setTimeout(() => {
      setRecentlyAdded((prev) => {
        if (!prev || prev.stamp !== recentlyAdded.stamp) return prev;
        if (prev.phase === 'pulse') return { ...prev, phase: 'settle' };
        return null;
      });
    }, recentlyAdded.phase === 'pulse' ? 520 : 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [recentlyAdded]);

  useEffect(() => {
    if (!boxReminder) return;

    const timer = window.setTimeout(() => {
      setBoxReminder((prev) => {
        if (!prev || prev.stamp !== boxReminder.stamp) return prev;
        if (prev.phase === 'flash') return { ...prev, phase: 'settle' };
        return null;
      });
    }, boxReminder.phase === 'flash' ? 560 : 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [boxReminder]);

  useEffect(() => {
    if (!fastTapHint) return;

    const timer = window.setTimeout(() => {
      setFastTapHint((prev) => {
        if (!prev || prev.stamp !== fastTapHint.stamp) return prev;
        if (prev.phase === 'show') return { ...prev, phase: 'hide' };
        return null;
      });
    }, fastTapHint.phase === 'show' ? 1400 : 420);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fastTapHint]);

  useEffect(() => {
    if (!submitNotice) return;

    const timer = window.setTimeout(() => {
      setSubmitNotice((prev) => {
        if (!prev || prev.stamp !== submitNotice.stamp) return prev;
        if (prev.phase === 'show') return { ...prev, phase: 'hide' };
        return null;
      });
    }, submitNotice.phase === 'show' ? 2200 : 420);

    return () => {
      window.clearTimeout(timer);
    };
  }, [submitNotice]);

  useEffect(() => {
    if (!seedOrdersNotice) return;

    const timer = window.setTimeout(() => {
      setSeedOrdersNotice((prev) => {
        if (!prev || prev.stamp !== seedOrdersNotice.stamp) return prev;
        if (prev.phase === 'show') return { ...prev, phase: 'hide' };
        return null;
      });
    }, seedOrdersNotice.phase === 'show' ? 1800 : 360);

    return () => {
      window.clearTimeout(timer);
    };
  }, [seedOrdersNotice]);

  useEffect(() => {
    if (!isCommandHubMode) {
      setCommandHubLoading(false);
      return;
    }

    let cancelled = false;

    const loadCommandHubOrders = async () => {
      setCommandHubLoading(true);
      setCommandHubLoadError(null);
      try {
        const snapshot = await ordersApi.getReviewSnapshot();
        if (cancelled) return;
        setCommandHubPendingReviewOrders(snapshot.pendingReview);
        setCommandHubTrackingOrders(snapshot.tracking);
        setCommandHubLastSyncedAt(Date.now());
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof OrdersApiError
          ? error.message
          : '目前無法讀取待審核清單，請稍後重試';
        setCommandHubLoadError(message);
      } finally {
        if (!cancelled) {
          setCommandHubLoading(false);
        }
      }
    };

    void loadCommandHubOrders();

    return () => {
      cancelled = true;
    };
  }, [authUser.storeId, commandHubRefreshToken, isCommandHubMode]);

  useEffect(() => {
    if (!reviewAlertToast) return;

    const exitTimer = window.setTimeout(() => {
      setReviewAlertToast((prev) => {
        if (!prev || prev.id !== reviewAlertToast.id) return prev;
        return { ...prev, phase: 'hide' };
      });
    }, 1800);

    const clearTimer = window.setTimeout(() => {
      setReviewAlertToast((prev) => {
        if (!prev || prev.id !== reviewAlertToast.id) return prev;
        return null;
      });
    }, 2300);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(clearTimer);
    };
  }, [reviewAlertToast]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    reviewPendingCountReadyRef.current = false;
    reviewPendingCountRef.current = 0;
    let cancelled = false;

    const syncPendingReviewCount = async () => {
      try {
        const snapshot = await ordersApi.getReviewSnapshot();
        if (cancelled) return;
        const nextCount = snapshot.pendingReview.length;
        if (!reviewPendingCountReadyRef.current) {
          reviewPendingCountRef.current = nextCount;
          reviewPendingCountReadyRef.current = true;
          return;
        }
        if (nextCount > reviewPendingCountRef.current) {
          showReviewAlertToast(`待確認 +${nextCount - reviewPendingCountRef.current}`);
        }
        reviewPendingCountRef.current = nextCount;
      } catch {
        // keep silent: this poll is best-effort only.
      }
    };

    void syncPendingReviewCount();
    const intervalId = window.setInterval(() => {
      void syncPendingReviewCount();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authUser.storeId]);

  useEffect(() => {
    setPackagingStatusByOrderId((prev) => {
      let changed = false;
      const next: Record<string, PackagingStatus> = {};
      packagingOrders.forEach((order) => {
        const existing = prev[order.id];
        if (existing) {
          next[order.id] = existing;
          return;
        }
        next[order.id] = 'waiting_pickup';
        changed = true;
      });

      if (!changed) {
        const prevKeys = Object.keys(prev);
        if (prevKeys.length !== Object.keys(next).length) {
          changed = true;
        } else {
          for (const key of prevKeys) {
            if (prev[key] !== next[key]) {
              changed = true;
              break;
            }
          }
        }
      }

      return changed ? next : prev;
    });
  }, [packagingOrders]);

  useEffect(() => {
    if (!waterForceFinishPromptTaskId) return;

    const timer = window.setTimeout(() => {
      setWaterForceFinishPromptTaskId((prev) =>
        prev === waterForceFinishPromptTaskId ? null : prev,
      );
    }, 2400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [waterForceFinishPromptTaskId]);

  useEffect(() => {
    if (!waterForceFinishPromptTaskId) return;
    const progress = getWaterTaskProgress(waterForceFinishPromptTaskId);
    if (progress.status !== 'cooking') {
      setWaterForceFinishPromptTaskId(null);
    }
  }, [waterForceFinishPromptTaskId, waterTaskProgress]);

  useEffect(() => {
    if (!waterTransferFx) return;

    const timer = window.setTimeout(() => {
      setWaterTransferFx((prev) => {
        if (!prev || prev.stamp !== waterTransferFx.stamp) return prev;
        if (prev.phase === 'show') return { ...prev, phase: 'hide' };
        return null;
      });
    }, waterTransferFx.phase === 'show' ? 360 : 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [waterTransferFx]);

  useEffect(() => {
    if (productionSection !== 'noodle') {
      setSelectedWaterTransferTaskId(null);
    }
  }, [productionSection]);

  useEffect(() => () => {
    clearIncrementPressTimers();
    clearTutorialStepTimer();
    if (dockAddButtonTimerRef.current !== null) {
      window.clearTimeout(dockAddButtonTimerRef.current);
      dockAddButtonTimerRef.current = null;
    }
    if (packagingQueuedTapTimerRef.current !== null) {
      window.clearTimeout(packagingQueuedTapTimerRef.current);
      packagingQueuedTapTimerRef.current = null;
    }
    Object.values(archiveOrderTimerRef.current).forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    archiveOrderTimerRef.current = {};
  }, []);

  const visibleMenuCategories = useMemo(
    () =>
      MENU_CATEGORIES.filter((category) =>
        noodleWorkflowEnabled ? true : category.id !== 'noodle',
      ),
    [noodleWorkflowEnabled],
  );

  const visibleCategoryIdSet = useMemo(
    () => new Set(visibleMenuCategories.map((category) => category.id)),
    [visibleMenuCategories],
  );

  useEffect(() => {
    if (visibleCategoryIdSet.has(activeCategory)) return;
    setActiveCategory('potsticker');
  }, [activeCategory, visibleCategoryIdSet]);

  const categoryItems = useMemo(
    () =>
      menuItems.filter(
        (item) =>
          item.category === activeCategory &&
          visibleCategoryIdSet.has(item.category),
      ),
    [activeCategory, menuItems, visibleCategoryIdSet],
  );

  const fillingItems = useMemo(
    () => ({
      potsticker: menuItems.filter((item) => item.category === 'potsticker'),
      dumpling: menuItems.filter((item) => item.category === 'dumpling'),
    }),
    [menuItems],
  );

  const availableFillingItems = useMemo(
    () => ({
      potsticker: availableMenuItems.filter((item) => item.category === 'potsticker'),
      dumpling: availableMenuItems.filter((item) => item.category === 'dumpling'),
    }),
    [availableMenuItems],
  );

  const quickMenuPools = useMemo(
    () => ({
      side: availableMenuItems.filter((item) => item.category === 'side'),
      soupDrink: availableMenuItems.filter((item) => item.category === 'soup_drink'),
      soupOnly: availableMenuItems.filter(
        (item) => item.category === 'soup_drink' && item.unit === '碗',
      ),
      drinkOnly: availableMenuItems.filter(
        (item) => item.category === 'soup_drink' && item.unit === '杯',
      ),
      soupDumpling: availableMenuItems.filter((item) => item.category === 'soup_dumpling'),
      noodle: noodleWorkflowEnabled
        ? availableMenuItems.filter((item) => item.category === 'noodle')
        : [],
    }),
    [availableMenuItems, noodleWorkflowEnabled],
  );

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cart],
  );

  const boxSummary = useMemo(() => {
    const rows: Array<{
      id: string;
      boxLabel: string;
      typeLabel: string;
      items: Array<{ name: string; count: number; unitPrice: number; subtotal: number }>;
      subtotal: number;
    }> = [];

    (['potsticker', 'dumpling'] as BoxOrderCategory[]).forEach((type) => {
      boxState[type].forEach((box, index) => {
        const option = BOX_OPTIONS.find((entry) => entry.id === box.optionId);
        const items = box.items
          .map((entry) => {
            const item = itemMap.get(entry.fillingId);
            if (!item) return null;
            const subtotal = item.price * entry.count;
            return {
              name: item.name,
              count: entry.count,
              unitPrice: item.price,
              subtotal,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

        const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

        rows.push({
          id: `${type}-${box.id}`,
          boxLabel: `盒 ${index + 1} · ${option?.label ?? '盒裝'}`,
          typeLabel: type === 'potsticker' ? '鍋貼盒' : '水餃盒',
          items,
          subtotal,
        });
      });
    });

    return rows;
  }, [boxState, itemMap]);

  const boxTotal = useMemo(
    () => boxSummary.reduce((sum, row) => sum + row.subtotal, 0),
    [boxSummary],
  );

  const totalAmount = cartTotal + boxTotal;
  const hasAnySelection = cart.length > 0 || boxTotal > 0;
  const totalBoxCount = boxState.potsticker.length + boxState.dumpling.length;
  const cartButtonCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0) + totalBoxCount,
    [cart, totalBoxCount],
  );
  const categoryItemCount = useMemo(() => {
    const counts: Record<MenuCategory, number> = {
      potsticker: boxState.potsticker.length,
      dumpling: boxState.dumpling.length,
      side: 0,
      soup_drink: 0,
      soup_dumpling: 0,
      noodle: 0,
    };

    cart.forEach((line) => {
      const item = itemMap.get(line.menuItemId);
      if (!item) return;
      if (item.category === 'noodle' && !noodleWorkflowEnabled) return;
      counts[item.category] += line.quantity;
    });

    return counts;
  }, [boxState, cart, itemMap, noodleWorkflowEnabled]);
  const cartQuantityByMenuItemId = useMemo(() => {
    const map = new Map<string, number>();
    cart.forEach((line) => {
      map.set(line.menuItemId, (map.get(line.menuItemId) ?? 0) + line.quantity);
    });
    return map;
  }, [cart]);

  const tutorialSwitchCategory = useMemo<MenuCategory>(() => {
    const preferred: MenuCategory[] = ['side', 'soup_drink', 'soup_dumpling', 'noodle', 'dumpling'];
    for (const category of preferred) {
      if (!visibleCategoryIdSet.has(category)) continue;
      const hasAvailableItems = menuItems.some(
        (item) => item.category === category && !(menuAvailabilityById.get(item.id)?.unavailable ?? true),
      );
      if (hasAvailableItems) return category;
    }
    return visibleMenuCategories.find((category) => category.id !== 'potsticker')?.id ?? 'dumpling';
  }, [menuAvailabilityById, menuItems, visibleCategoryIdSet, visibleMenuCategories]);

  const tutorialPotstickerFillItemId = useMemo(() => {
    const preferredPool = availableFillingItems.potsticker.length > 0
      ? availableFillingItems.potsticker
      : fillingItems.potsticker;
    return preferredPool[0]?.id ?? fillingItems.potsticker[0]?.id ?? '';
  }, [availableFillingItems.potsticker, fillingItems.potsticker]);
  const tutorialSwitchBoxId = boxState.potsticker[1]?.id ?? boxState.potsticker[0]?.id ?? '';

  const tutorialMenuTargetItemId = useMemo(() => {
    const availableItem = categoryItems.find(
      (item) => !(menuAvailabilityById.get(item.id)?.unavailable ?? true),
    );
    return availableItem?.id ?? categoryItems[0]?.id ?? '';
  }, [categoryItems, menuAvailabilityById]);

  const tutorialTargetKey = useMemo(() => {
    if (!customerTutorialActive) return null;
    switch (customerTutorialStep) {
      case 'box_add':
        return boxState.potsticker.length === 0
          ? 'box-add-hero-potsticker'
          : 'box-add-dock-potsticker';
      case 'box_switch':
        return tutorialSwitchBoxId ? `box-card-${tutorialSwitchBoxId}` : null;
      case 'box_fill':
        return tutorialPotstickerFillItemId
          ? `box-fill-plus-${tutorialPotstickerFillItemId}`
          : null;
      case 'switch_category':
        return `category-${tutorialSwitchCategory}`;
      case 'add_item_open':
        return tutorialMenuTargetItemId ? `menu-add-${tutorialMenuTargetItemId}` : null;
      default:
        return null;
    }
  }, [
    boxState.potsticker.length,
    customerTutorialActive,
    customerTutorialStep,
    tutorialMenuTargetItemId,
    tutorialPotstickerFillItemId,
    tutorialSwitchBoxId,
    tutorialSwitchCategory,
  ]);

  const getTutorialFocusClass = (key: string) =>
    customerTutorialActive && tutorialTargetKey === key
      ? 'bafang-tutorial-focus relative z-[65]'
      : '';

  const customerTutorialStepIndex = Math.max(
    0,
    CUSTOMER_TUTORIAL_STEPS.findIndex((step) => step === customerTutorialStep),
  );
  const customerTutorialProgress = ((customerTutorialStepIndex + 1) / CUSTOMER_TUTORIAL_STEPS.length) * 100;

  const customerTutorialCurrentLabel = useMemo(() => {
    switch (customerTutorialStep) {
      case 'box_add':
        return {
          title: '先幫您開第一盒',
          description: '先開第一盒鍋貼。',
        };
      case 'box_switch':
        return {
          title: '切換到下一盒',
          description: '切到亮起那盒。',
        };
      case 'box_fill':
        return {
          title: '先補幾顆鍋貼',
          description: `點亮起的 +，先加到 ${TUTORIAL_BOX_FILL_TARGET} 顆即可。`,
        };
      case 'switch_category':
        return {
          title: '接著切到其他分類',
          description: '切到亮起分類。',
        };
      case 'add_item_open':
        return {
          title: '展開品項操作',
          description: '按「加入購物車」。',
        };
      default:
        return {
          title: '操作導覽',
          description: '依序完成流程操作。',
        };
    }
  }, [customerTutorialStep]);

  const tutorialActivePotstickerBox = useMemo(() => {
    const activeId = activeBoxState.potsticker;
    return boxState.potsticker.find((entry) => entry.id === activeId) ?? boxState.potsticker[0] ?? null;
  }, [activeBoxState.potsticker, boxState.potsticker]);

  const tutorialFillCount = useMemo(() => {
    if (!tutorialActivePotstickerBox) return 0;
    return getBoxUsage(tutorialActivePotstickerBox);
  }, [tutorialActivePotstickerBox]);

  const tutorialStepReady = useMemo(() => {
    if (!customerTutorialActive) return false;
    switch (customerTutorialStep) {
      case 'box_add':
        return boxState.potsticker.length > 0;
      case 'box_switch':
        return tutorialSwitchBoxId.length > 0 && activeBoxState.potsticker === tutorialSwitchBoxId;
      case 'box_fill':
        return tutorialFillCount >= TUTORIAL_BOX_FILL_TARGET;
      case 'switch_category':
        return activeCategory === tutorialSwitchCategory;
      case 'add_item_open':
        return expandedConfigItemId !== null;
      default:
        return false;
    }
  }, [
    activeBoxState.potsticker,
    activeCategory,
    boxState.potsticker.length,
    customerTutorialActive,
    customerTutorialStep,
    expandedConfigItemId,
    tutorialFillCount,
    tutorialMenuTargetItemId,
    tutorialSwitchBoxId,
    tutorialSwitchCategory,
  ]);

  const tutorialNextStep = customerTutorialStepIndex < CUSTOMER_TUTORIAL_STEPS.length - 1
    ? CUSTOMER_TUTORIAL_STEPS[customerTutorialStepIndex + 1]
    : null;
  const tutorialCanProceed = customerTutorialStep === 'box_add' ? tutorialStepReady : true;

  const tutorialStepTitle = (step: CustomerTutorialStep) => {
    switch (step) {
      case 'box_add':
        return '開第一盒';
      case 'box_switch':
        return '切換盒';
      case 'box_fill':
        return '放入鍋貼';
      case 'switch_category':
        return '切換分類';
      case 'add_item_open':
        return '展開品項';
      default:
        return '下一步';
    }
  };

  const tutorialTooltipStyle = useMemo(() => {
    if (!tutorialSpotlightRect || typeof window === 'undefined') return null;
    const viewportPadding = window.innerWidth < 640 ? 12 : 14;
    const gap = window.innerWidth < 640 ? 14 : 16;
    const dockReserve = window.innerWidth < 640 ? 132 : 112;
    const viewportBottom = Math.max(220, window.innerHeight - dockReserve);
    const minWidth = 252;
    const maxWidth = 340;
    const minHeight = 156;
    const maxHeight = 280;
    const baseWidth = Math.min(
      maxWidth,
      Math.max(minWidth, window.innerWidth - viewportPadding * 2),
    );
    const focus = {
      top: tutorialSpotlightRect.top,
      bottom: tutorialSpotlightRect.top + tutorialSpotlightRect.height,
      left: tutorialSpotlightRect.left,
      right: tutorialSpotlightRect.left + tutorialSpotlightRect.width,
    };
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const topSpace = focus.top - gap - viewportPadding;
    const bottomSpace = viewportBottom - focus.bottom - gap - viewportPadding;
    const leftSpace = focus.left - gap - viewportPadding;
    const rightSpace = window.innerWidth - focus.right - gap - viewportPadding;
    const sideMinWidth = 188;
    const resolveHeight = (space: number) =>
      clamp(space, minHeight, maxHeight);

    if (bottomSpace >= minHeight) {
      return {
        left: clamp(
          focus.left + (tutorialSpotlightRect.width - baseWidth) / 2,
          viewportPadding,
          window.innerWidth - baseWidth - viewportPadding,
        ),
        top: focus.bottom + gap,
        width: baseWidth,
        maxHeight: resolveHeight(bottomSpace),
      };
    }

    if (topSpace >= minHeight) {
      const maxHeightTop = resolveHeight(topSpace);
      return {
        left: clamp(
          focus.left + (tutorialSpotlightRect.width - baseWidth) / 2,
          viewportPadding,
          window.innerWidth - baseWidth - viewportPadding,
        ),
        top: clamp(
          focus.top - gap - maxHeightTop,
          viewportPadding,
          window.innerHeight - maxHeightTop - viewportPadding,
        ),
        width: baseWidth,
        maxHeight: maxHeightTop,
      };
    }

    if (rightSpace >= sideMinWidth) {
      const width = Math.min(baseWidth, rightSpace);
      const top = clamp(
        focus.top + (tutorialSpotlightRect.height - maxHeight) / 2,
        viewportPadding,
        viewportBottom - minHeight - viewportPadding,
      );
      return {
        left: focus.right + gap,
        top,
        width,
        maxHeight: clamp(viewportBottom - top - viewportPadding, minHeight, maxHeight),
      };
    }

    if (leftSpace >= sideMinWidth) {
      const width = Math.min(baseWidth, leftSpace);
      const top = clamp(
        focus.top + (tutorialSpotlightRect.height - maxHeight) / 2,
        viewportPadding,
        viewportBottom - minHeight - viewportPadding,
      );
      return {
        left: clamp(
          focus.left - gap - width,
          viewportPadding,
          window.innerWidth - width - viewportPadding,
        ),
        top,
        width,
        maxHeight: clamp(viewportBottom - top - viewportPadding, minHeight, maxHeight),
      };
    }

    return {
      left: viewportPadding,
      top: clamp(
        focus.bottom + gap,
        viewportPadding,
        viewportBottom - minHeight - viewportPadding,
      ),
      width: Math.min(baseWidth, window.innerWidth - viewportPadding * 2),
      maxHeight: Math.min(maxHeight, viewportBottom - viewportPadding * 2),
    };
  }, [tutorialSpotlightRect]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      tutorialStorageKey,
      JSON.stringify(customerTutorialPreference),
    );
  }, [customerTutorialPreference, tutorialStorageKey]);

  useEffect(() => {
    const lockedPerspective = userPerspectivePolicy.lockedPerspective;
    if (!lockedPerspective) return;
    if (activePerspective === lockedPerspective) return;
    setActivePerspective(lockedPerspective);
  }, [activePerspective, userPerspectivePolicy.lockedPerspective]);

  useEffect(() => {
    if (allowedPerspectiveSet.has(activePerspective)) return;
    setActivePerspective(userPerspectivePolicy.defaultPerspective);
  }, [activePerspective, allowedPerspectiveSet, userPerspectivePolicy.defaultPerspective]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const snapshot: UserRuntimeSnapshot = {
      version: 1,
      activePerspective,
      customerPage,
      serviceMode,
      activeCategory,
      cart,
      cartOrderNote,
      boxState,
      activeBoxState,
      orderSequence,
      productionOrders,
      packagingOrders,
      packagingStatusByOrderId,
      packagingItemStatusOverrides,
      packagingPinnedOrderIds,
      workflowOrderNotes,
      archivedOrderIds,
      friedEntryIds,
      friedPotstickerPieces,
      fryStations,
      splitOrderIds,
      waterLadleCountByStationId,
      waterTaskProgress,
      waterUnlockedTaskIds,
      waterDumplingTargetCount,
      waterDumplingCapturedTaskIds,
      productionSection,
      activeProductionStationIndexBySection,
      activePackagingLane,
      packagingTopQueueSize,
      packagingTopQueueLimit,
      packagingTopQueueLimitInput,
    };
    window.localStorage.setItem(runtimeStorageKey, JSON.stringify(snapshot));
  }, [
    activeBoxState,
    activeCategory,
    activePackagingLane,
    activePerspective,
    activeProductionStationIndexBySection,
    archivedOrderIds,
    boxState,
    cart,
    cartOrderNote,
    customerPage,
    friedEntryIds,
    friedPotstickerPieces,
    fryStations,
    orderSequence,
    packagingItemStatusOverrides,
    packagingOrders,
    packagingPinnedOrderIds,
    packagingStatusByOrderId,
    packagingTopQueueLimit,
    packagingTopQueueLimitInput,
    packagingTopQueueSize,
    productionOrders,
    productionSection,
    runtimeStorageKey,
    serviceMode,
    splitOrderIds,
    waterDumplingCapturedTaskIds,
    waterDumplingTargetCount,
    waterLadleCountByStationId,
    waterTaskProgress,
    waterUnlockedTaskIds,
    workflowOrderNotes,
  ]);

  useEffect(() => {
    if (!customerTutorialActive) return;
    if (!allowedPerspectiveSet.has('customer')) {
      setCustomerTutorialActive(false);
      return;
    }
    if (activePerspective !== 'customer') {
      setActivePerspective('customer');
    }
    if (customerPage !== 'ordering') {
      setCustomerPage('ordering');
    }
    if (
      (
        customerTutorialStep === 'box_add' ||
        customerTutorialStep === 'box_switch' ||
        customerTutorialStep === 'box_fill'
      ) &&
      activeCategory !== 'potsticker'
    ) {
      setActiveCategory('potsticker');
    }
    if (!serviceMode) {
      setServiceMode('dine_in');
    }
  }, [
    activeCategory,
    activePerspective,
    allowedPerspectiveSet,
    customerPage,
    customerTutorialActive,
    customerTutorialStep,
    serviceMode,
  ]);

  useEffect(() => {
    if (activePerspective !== 'customer' || !customerTutorialActive || !tutorialTargetKey) {
      setTutorialSpotlightRect(null);
      return;
    }

    let frameId: number | null = null;
    const updateRect = () => {
      const node = tutorialTargetRefs.current[tutorialTargetKey];
      if (!node) {
        setTutorialSpotlightRect(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const padding = 12;
      const top = Math.max(8, rect.top - padding);
      const left = Math.max(8, rect.left - padding);
      const maxWidth = Math.max(0, window.innerWidth - left - 8);
      const maxHeight = Math.max(0, window.innerHeight - top - 8);
      const width = Math.min(maxWidth, rect.width + padding * 2);
      const height = Math.min(maxHeight, rect.height + padding * 2);
      setTutorialSpotlightRect({ top, left, width, height });
    };

    const scrollTargetToCenter = () => {
      const node = tutorialTargetRefs.current[tutorialTargetKey];
      if (!node) return;
      node.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    };

    scrollTargetToCenter();
    frameId = window.requestAnimationFrame(() => {
      updateRect();
    });

    const settleTimer = window.setTimeout(updateRect, 420);
    const intervalId = window.setInterval(updateRect, 180);
    const sync = () => updateRect();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.clearTimeout(settleTimer);
      window.clearInterval(intervalId);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [
    activePerspective,
    customerPage,
    customerTutorialActive,
    customerTutorialStep,
    tutorialTargetKey,
  ]);

  const fryQueueEntries = useMemo<FryOrderEntry[]>(() => {
    const splitOrderIdSet = new Set(splitOrderIds);
    return productionOrders
      .flatMap((order) => {
        const potstickerBoxRows = order.boxRows.filter((row) => row.id.startsWith('potsticker-'));
        const looseFlavorMap = new Map<string, number>();
        let loosePotstickerCount = 0;
        let looseDurationSeconds = Math.max(1, FRY_BATCH_SECONDS);

        order.cartLines.forEach((line) => {
          const item = itemMap.get(line.menuItemId);
          if (!item || item.prepStation !== 'griddle') return;
          const flavorName = normalizePotstickerFlavorName(line.name);
          looseFlavorMap.set(flavorName, (looseFlavorMap.get(flavorName) ?? 0) + line.quantity);
          loosePotstickerCount += line.quantity;
          looseDurationSeconds = Math.max(
            looseDurationSeconds,
            Math.max(1, Math.round(item.prepSeconds) || FRY_BATCH_SECONDS),
          );
        });

        if (splitOrderIdSet.has(order.id) && potstickerBoxRows.length > 0) {
          const splitEntries: FryOrderEntry[] = [];

          potstickerBoxRows.forEach((row, index) => {
            const flavorMap = new Map<string, number>();
            let potstickerCount = 0;
            let rowDurationSeconds = Math.max(1, FRY_BATCH_SECONDS);
            row.items.forEach((rowItem) => {
              const menuItem = itemNameCategoryMap.get(`potsticker:${rowItem.name}`.toLowerCase());
              if (!menuItem || menuItem.prepStation !== 'griddle') return;
              const flavorName = normalizePotstickerFlavorName(rowItem.name);
              flavorMap.set(flavorName, (flavorMap.get(flavorName) ?? 0) + rowItem.count);
              potstickerCount += rowItem.count;
              rowDurationSeconds = Math.max(
                rowDurationSeconds,
                Math.max(1, Math.round(menuItem.prepSeconds) || FRY_BATCH_SECONDS),
              );
            });

            if (potstickerCount <= 0) return;

            splitEntries.push({
              entryId: `${order.id}::box:${row.id}`,
              orderId: order.id,
              entryLabel: `盒 ${index + 1}`,
              priority: index,
              createdAt: order.createdAt,
              serviceMode: order.serviceMode,
              potstickerCount,
              flavorCounts: Array.from(flavorMap.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
              durationSeconds: rowDurationSeconds,
            });
          });

          if (loosePotstickerCount > 0) {
            splitEntries.push({
              entryId: `${order.id}::loose`,
              orderId: order.id,
              entryLabel: '散單',
              priority: 900,
              createdAt: order.createdAt,
              serviceMode: order.serviceMode,
              potstickerCount: loosePotstickerCount,
              flavorCounts: Array.from(looseFlavorMap.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
              durationSeconds: looseDurationSeconds,
            });
          }

          return splitEntries;
        }

        const flavorMap = new Map<string, number>();
        let boxDurationSeconds = Math.max(1, FRY_BATCH_SECONDS);

        const boxPotstickerCount = potstickerBoxRows
          .reduce((sum, row) => {
            row.items.forEach((rowItem) => {
              const menuItem = itemNameCategoryMap.get(`potsticker:${rowItem.name}`.toLowerCase());
              if (!menuItem || menuItem.prepStation !== 'griddle') return;
              const flavorName = normalizePotstickerFlavorName(rowItem.name);
              flavorMap.set(flavorName, (flavorMap.get(flavorName) ?? 0) + rowItem.count);
              boxDurationSeconds = Math.max(
                boxDurationSeconds,
                Math.max(1, Math.round(menuItem.prepSeconds) || FRY_BATCH_SECONDS),
              );
            });
            return sum + row.items.reduce((itemSum, rowItem) => {
              const menuItem = itemNameCategoryMap.get(`potsticker:${rowItem.name}`.toLowerCase());
              if (!menuItem || menuItem.prepStation !== 'griddle') return itemSum;
              return itemSum + rowItem.count;
            }, 0);
          }, 0);
        const cartPotstickerCount = loosePotstickerCount;
        looseFlavorMap.forEach((count, name) => {
          flavorMap.set(name, (flavorMap.get(name) ?? 0) + count);
        });

        const totalPotstickerCount = boxPotstickerCount + cartPotstickerCount;
        if (totalPotstickerCount <= 0) return [];

        return [{
          entryId: `${order.id}::full`,
          orderId: order.id,
          entryLabel: '整單',
          priority: 0,
          createdAt: order.createdAt,
          serviceMode: order.serviceMode,
          potstickerCount: totalPotstickerCount,
          flavorCounts: Array.from(flavorMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
          durationSeconds: Math.max(boxDurationSeconds, looseDurationSeconds),
        }];
      })
      .filter((entry) => entry.potstickerCount > 0)
      .sort(
        (a, b) =>
          a.createdAt - b.createdAt ||
          a.orderId.localeCompare(b.orderId) ||
          a.priority - b.priority,
      );
  }, [itemMap, itemNameCategoryMap, productionOrders, splitOrderIds]);

  const friedEntryIdSet = useMemo(() => new Set(friedEntryIds), [friedEntryIds]);

  const lockedFryEntryIdSet = useMemo(() => {
    const idSet = new Set<string>();
    FRY_STATION_ORDER.forEach((stationId) => {
      fryStations[stationId].lockedBatch?.entryIds.forEach((entryId) => {
        idSet.add(entryId);
      });
    });
    return idSet;
  }, [fryStations]);

  const lockedFryOrderIdSet = useMemo(() => {
    const orderIdSet = new Set<string>();
    FRY_STATION_ORDER.forEach((stationId) => {
      fryStations[stationId].lockedBatch?.orders.forEach((entry) => {
        orderIdSet.add(entry.orderId);
      });
    });
    return orderIdSet;
  }, [fryStations]);

  const pickFryBatch = (
    capacity: number,
    queue: FryOrderEntry[],
    excludedEntryIds: Set<string>,
  ): FryRecommendation => {
    const available = queue.filter((entry) => !excludedEntryIds.has(entry.entryId));
    if (available.length === 0) {
      return {
        orders: [],
        totalPotstickers: 0,
        blockedOrder: null,
      };
    }

    if (available[0].potstickerCount > capacity) {
      return {
        orders: [],
        totalPotstickers: 0,
        blockedOrder: available[0],
      };
    }

    const orders: FryOrderEntry[] = [];
    let totalPotstickers = 0;
    for (const entry of available) {
      if (totalPotstickers + entry.potstickerCount <= capacity) {
        orders.push(entry);
        totalPotstickers += entry.potstickerCount;
        continue;
      }
      // FIFO: once front tasks cannot fit, stop and keep sequence priority.
      break;
    }

    return {
      orders,
      totalPotstickers,
      blockedOrder: null,
    };
  };

  const fryRecommendations = useMemo<Record<FryStationId, FryRecommendation>>(() => {
    const reservedEntryIds = new Set<string>(friedEntryIds);
    FRY_STATION_ORDER.forEach((stationId) => {
      fryStations[stationId].lockedBatch?.entryIds.forEach((entryId) => {
        reservedEntryIds.add(entryId);
      });
    });

    const next: Partial<Record<FryStationId, FryRecommendation>> = {};

    FRY_STATION_ORDER.forEach((stationId) => {
      const station = fryStations[stationId];
      if (station.lockedBatch) {
        next[stationId] = {
          orders: station.lockedBatch.orders,
          totalPotstickers: station.lockedBatch.totalPotstickers,
          blockedOrder: null,
        };
        return;
      }

      const recommendation = pickFryBatch(station.capacity, fryQueueEntries, reservedEntryIds);
      next[stationId] = recommendation;
      recommendation.orders.forEach((entry) => {
        reservedEntryIds.add(entry.entryId);
      });
    });

    return next as Record<FryStationId, FryRecommendation>;
  }, [friedEntryIds, fryQueueEntries, fryRecalcVersion, fryStations]);

  const estimatedStationByEntryId = useMemo(() => {
    const map = new Map<string, string>();
    FRY_STATION_ORDER.forEach((stationId) => {
      const station = fryStations[stationId];
      if (station.lockedBatch) return;
      fryRecommendations[stationId].orders.forEach((entry) => {
        map.set(entry.entryId, station.label);
      });
    });
    return map;
  }, [fryRecommendations, fryStations]);

  const fryBacklogCount = useMemo(
    () =>
      fryQueueEntries.filter(
        (entry) => !friedEntryIdSet.has(entry.entryId) && !lockedFryEntryIdSet.has(entry.entryId),
      ).length,
    [friedEntryIdSet, fryQueueEntries, lockedFryEntryIdSet],
  );

  const fryingPreviewDetail = useMemo(() => {
    const groups = new Map<string, {
      orderId: string;
      createdAt: number;
      serviceMode: ServiceMode;
      totalPotstickers: number;
      entries: FryOrderEntry[];
      stationLabels: string[];
    }>();

    FRY_STATION_ORDER.forEach((stationId) => {
      const station = fryStations[stationId];
      const lockedBatch = station.lockedBatch;
      if (!lockedBatch?.timerStartedAt) return;

      lockedBatch.orders.forEach((entry) => {
        const existing = groups.get(entry.orderId);
        if (existing) {
          existing.totalPotstickers += entry.potstickerCount;
          existing.entries.push(entry);
          if (!existing.stationLabels.includes(station.label)) {
            existing.stationLabels.push(station.label);
          }
          return;
        }
        groups.set(entry.orderId, {
          orderId: entry.orderId,
          createdAt: entry.createdAt,
          serviceMode: entry.serviceMode,
          totalPotstickers: entry.potstickerCount,
          entries: [entry],
          stationLabels: [station.label],
        });
      });
    });

    return Array.from(groups.values()).sort(
      (a, b) => a.createdAt - b.createdAt || a.orderId.localeCompare(b.orderId),
    );
  }, [fryStations]);
  const fryingOrderCount = fryingPreviewDetail.length;

  const friedFryOrderIdSet = useMemo(() => {
    const set = new Set<string>();
    friedEntryIds.forEach((entryId) => {
      const orderId = entryId.split('::')[0];
      if (orderId) set.add(orderId);
    });
    return set;
  }, [friedEntryIds]);

  const splitOrderIdSet = useMemo(() => new Set(splitOrderIds), [splitOrderIds]);

  const potstickerBoxCountByOrder = useMemo(() => {
    const map = new Map<string, number>();
    productionOrders.forEach((order) => {
      const boxCount = order.boxRows.filter((row) => row.id.startsWith('potsticker-')).length;
      map.set(order.id, boxCount);
    });
    return map;
  }, [productionOrders]);

  const fryBacklogPreview = useMemo(() => {
    const groups = new Map<string, {
      orderId: string;
      createdAt: number;
      serviceMode: ServiceMode;
      totalPotstickers: number;
      entries: FryOrderEntry[];
    }>();

    fryQueueEntries.forEach((entry) => {
      if (friedEntryIdSet.has(entry.entryId) || lockedFryEntryIdSet.has(entry.entryId)) return;
      const existing = groups.get(entry.orderId);
      if (existing) {
        existing.totalPotstickers += entry.potstickerCount;
        existing.entries.push(entry);
        return;
      }
      groups.set(entry.orderId, {
        orderId: entry.orderId,
        createdAt: entry.createdAt,
        serviceMode: entry.serviceMode,
        totalPotstickers: entry.potstickerCount,
        entries: [entry],
      });
    });

    return Array.from(groups.values()).sort(
      (a, b) => a.createdAt - b.createdAt || a.orderId.localeCompare(b.orderId),
    );
  }, [friedEntryIdSet, fryQueueEntries, lockedFryEntryIdSet]);

  const fryBacklogOrderCount = fryBacklogPreview.length;

  const waterTasks = useMemo<WaterTask[]>(() => {
    const tasks: WaterTask[] = [];

    productionOrders.forEach((order) => {
      let priorityCursor = 0;
      const dumplingRows = order.boxRows.filter((row) => row.id.startsWith('dumpling-'));

      dumplingRows.forEach((row) => {
        const preparedRowItems = row.items
          .map((rowItem) => {
            const menuItem = itemNameCategoryMap.get(`dumpling:${rowItem.name}`.toLowerCase());
            if (!menuItem || menuItem.prepStation !== 'dumpling') return null;
            return {
              name: normalizeDumplingFlavorName(rowItem.name),
              count: rowItem.count,
              prepSeconds: Math.max(1, Math.round(menuItem.prepSeconds) || WATER_DUMPLING_SECONDS),
            };
          })
          .filter((rowItem): rowItem is NonNullable<typeof rowItem> => rowItem !== null);
        const totalCount = preparedRowItems.reduce((sum, rowItem) => sum + rowItem.count, 0);
        if (totalCount <= 0) return;
        const rowFlavorCounts = preparedRowItems
          .map((rowItem) => ({
            name: rowItem.name,
            count: rowItem.count,
          }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        const flavorDetail = preparedRowItems
          .map((rowItem) => `${rowItem.name} ${rowItem.count}顆`)
          .join(' · ');
        const baseDuration = preparedRowItems.reduce(
          (max, rowItem) => Math.max(max, rowItem.prepSeconds),
          WATER_DUMPLING_SECONDS,
        );
        const durationSeconds = baseDuration + Math.max(0, Math.ceil(totalCount / 8) - 1) * 6;

        tasks.push({
          taskId: `${order.id}::water:dumpling-box:${row.id}`,
          orderId: order.id,
          createdAt: order.createdAt,
          serviceMode: order.serviceMode,
          type: 'dumpling',
          title: row.boxLabel,
          quantity: totalCount,
          unitLabel: '顆',
          details: ['盒裝水餃', flavorDetail],
          flavorCounts: rowFlavorCounts,
          requiresLadle: false,
          durationSeconds,
          priority: priorityCursor,
        });
        priorityCursor += 1;
      });

      order.cartLines.forEach((line, lineIndex) => {
        const item = itemMap.get(line.menuItemId);
        if (!item) return;
        const prepStation = item.prepStation;
        if (prepStation === 'none') return;

        if (item.category === 'dumpling' && prepStation === 'dumpling') {
          const quantity = line.quantity;
          if (quantity <= 0) return;
          const flavorName = normalizeDumplingFlavorName(line.name);
          const baseDuration = Math.max(1, Math.round(item.prepSeconds) || WATER_DUMPLING_SECONDS);
          const durationSeconds = baseDuration + Math.max(0, Math.ceil(quantity / 8) - 1) * 4;
          tasks.push({
            taskId: `${order.id}::water:dumpling-line:${line.id}`,
            orderId: order.id,
            createdAt: order.createdAt,
            serviceMode: order.serviceMode,
            type: 'dumpling',
            title: '單點水餃',
            quantity,
            unitLabel: '顆',
            note: line.note,
            details: [`${flavorName} ${quantity}顆`, ...(line.note ? [`備註：${line.note}`] : [])],
            flavorCounts: [{ name: flavorName, count: quantity }],
            requiresLadle: false,
            durationSeconds,
            priority: priorityCursor + lineIndex,
          });
          return;
        }

        if (item.category === 'soup_dumpling' && prepStation === 'dumpling') {
          const perBowlCount = line.soupDumplingCount ?? 8;
          const quantity = perBowlCount * line.quantity;
          if (quantity <= 0) return;
          const flavorName = normalizeDumplingFlavorName(line.soupFlavorName ?? '招牌水餃');
          const baseDuration = Math.max(1, Math.round(item.prepSeconds) || WATER_DUMPLING_SECONDS);
          const durationSeconds = baseDuration + Math.max(0, line.quantity - 1) * 5;
          tasks.push({
            taskId: `${order.id}::water:soup-dumpling:${line.id}`,
            orderId: order.id,
            createdAt: order.createdAt,
            serviceMode: order.serviceMode,
            type: 'dumpling',
            title: line.name,
            quantity,
            unitLabel: '顆',
            note: line.note,
            details: [
              `${line.name} × ${line.quantity}`,
              `${flavorName} ${quantity}顆`,
              ...(line.note ? [`備註：${line.note}`] : []),
            ],
            flavorCounts: [{ name: flavorName, count: quantity }],
            requiresLadle: false,
            durationSeconds,
            priority: priorityCursor + lineIndex,
          });
          return;
        }

        if (item.category === 'noodle' && prepStation === 'noodle') {
          const quantity = line.quantity;
          if (quantity <= 0) return;
          const staple = line.customLabel === '冬粉' ? '冬粉' : '麵條';
          const fallbackDuration = staple === '冬粉' ? WATER_VERMICELLI_SECONDS : WATER_NOODLE_SECONDS;
          const baseDuration = Math.max(1, Math.round(item.prepSeconds) || fallbackDuration);
          const durationSeconds = baseDuration + Math.max(0, quantity - 1) * 8;
          tasks.push({
            taskId: `${order.id}::water:noodle:${line.id}`,
            orderId: order.id,
            createdAt: order.createdAt,
            serviceMode: order.serviceMode,
            type: 'noodle',
            title: `${line.name}${line.customLabel ? ` · ${line.customLabel}` : ''}`,
            quantity,
            unitLabel: '份',
            note: line.note,
            details: [`${quantity}份`, `${staple}流程`, ...(line.note ? [`備註：${line.note}`] : [])],
            flavorCounts: [],
            requiresLadle: true,
            durationSeconds,
            priority: priorityCursor + lineIndex,
          });
          return;
        }

        if (item.category === 'side' && prepStation === 'noodle') {
          const quantity = line.quantity;
          if (quantity <= 0) return;
          const baseDuration = Math.max(1, Math.round(item.prepSeconds) || WATER_SIDE_HEAT_SECONDS);
          const durationSeconds = baseDuration + Math.max(0, quantity - 1) * 6;
          tasks.push({
            taskId: `${order.id}::water:side-heat:${line.id}`,
            orderId: order.id,
            createdAt: order.createdAt,
            serviceMode: order.serviceMode,
            type: 'side_heat',
            title: line.name,
            quantity,
            unitLabel: '份',
            note: line.note,
            details: [`${quantity}份`, '麵杓加熱', ...(line.note ? [`備註：${line.note}`] : [])],
            flavorCounts: [],
            requiresLadle: true,
            durationSeconds,
            priority: priorityCursor + lineIndex,
          });
          return;
        }

        if (item.category === 'soup_drink' && prepStation === 'noodle') {
          const quantity = line.quantity;
          if (quantity <= 0) return;
          const baseDuration = Math.max(1, Math.round(item.prepSeconds) || WATER_SIDE_HEAT_SECONDS);
          const durationSeconds = baseDuration + Math.max(0, quantity - 1) * 4;
          tasks.push({
            taskId: `${order.id}::water:soup-drink:${line.id}`,
            orderId: order.id,
            createdAt: order.createdAt,
            serviceMode: order.serviceMode,
            type: 'side_heat',
            title: line.name,
            quantity,
            unitLabel: item.unit,
            note: line.note,
            details: [`${quantity}${item.unit}`, ...(line.note ? [`備註：${line.note}`] : [])],
            flavorCounts: [],
            requiresLadle: true,
            durationSeconds,
            priority: priorityCursor + lineIndex,
          });
        }
      });
    });

    return tasks.sort(
      (a, b) =>
        a.createdAt - b.createdAt ||
        a.orderId.localeCompare(b.orderId) ||
          a.priority - b.priority ||
          a.taskId.localeCompare(b.taskId),
    );
  }, [itemMap, itemNameCategoryMap, productionOrders]);

  const waterTaskMap = useMemo(
    () => new Map<string, WaterTask>(waterTasks.map((task) => [task.taskId, task])),
    [waterTasks],
  );

  useEffect(() => {
    setWaterTaskProgress((prev) => {
      const taskIds = new Set(waterTasks.map((task) => task.taskId));
      let changed = false;
      const next: Record<string, WaterTaskProgress> = {};

      Object.entries(prev).forEach(([taskId, progress]) => {
        if (!taskIds.has(taskId)) {
          changed = true;
          return;
        }
        next[taskId] = progress;
      });

      waterTasks.forEach((task) => {
        if (next[task.taskId]) return;
        next[task.taskId] = {
          status: 'queued',
          startedAt: null,
          ladleSlot: null,
        };
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [waterTasks]);

  const getWaterTaskProgress = (taskId: string): WaterTaskProgress =>
    waterTaskProgress[taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };

  const waterTaskStationByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    waterTasks.forEach((task) => {
      const module: ProductionSection = task.type === 'dumpling' ? 'dumpling' : 'noodle';
      const stationId = productionOrderStationByModule[module].get(task.orderId);
      if (stationId) {
        map.set(task.taskId, stationId);
      }
    });
    return map;
  }, [productionOrderStationByModule, waterTasks]);

  const waterQueuedTasksAll = useMemo(
    () => waterTasks.filter((task) => getWaterTaskProgress(task.taskId).status === 'queued'),
    [waterTaskProgress, waterTasks],
  );

  const waterCookingTasksAll = useMemo(
    () => waterTasks.filter((task) => getWaterTaskProgress(task.taskId).status === 'cooking'),
    [waterTaskProgress, waterTasks],
  );

  const waterDoneTasksAll = useMemo(
    () => waterTasks.filter((task) => getWaterTaskProgress(task.taskId).status === 'done'),
    [waterTaskProgress, waterTasks],
  );

  const isWaterTaskAssignedToActiveStation = (task: WaterTask) => {
    const module: ProductionSection = task.type === 'dumpling' ? 'dumpling' : 'noodle';
    const activeStationId = activeProductionStationIdByModule[module];
    if (!activeStationId) return true;
    const assignedStationId = waterTaskStationByTaskId.get(task.taskId);
    return !assignedStationId || assignedStationId === activeStationId;
  };

  const waterQueuedTasks = useMemo(
    () => waterQueuedTasksAll.filter((task) => isWaterTaskAssignedToActiveStation(task)),
    [activeProductionStationIdByModule, waterQueuedTasksAll, waterTaskStationByTaskId],
  );

  const waterCookingTasks = useMemo(
    () => waterCookingTasksAll.filter((task) => isWaterTaskAssignedToActiveStation(task)),
    [activeProductionStationIdByModule, waterCookingTasksAll, waterTaskStationByTaskId],
  );

  const waterDoneTasks = useMemo(
    () => waterDoneTasksAll.filter((task) => isWaterTaskAssignedToActiveStation(task)),
    [activeProductionStationIdByModule, waterDoneTasksAll, waterTaskStationByTaskId],
  );

  const waterQueuedDumplingTasks = useMemo(
    () => waterQueuedTasks.filter((task) => task.type === 'dumpling'),
    [waterQueuedTasks],
  );

  const waterEstimatedDumplingBatch = useMemo<WaterDumplingBatchRecommendation>(() => {
    const queue = waterQueuedDumplingTasks;
    if (queue.length === 0) {
      return {
        tasks: [],
        totalCount: 0,
        overflowFallback: false,
      };
    }

    const targetCount = Math.max(20, Math.min(100, Math.round(waterDumplingTargetCount)));
    if (queue[0].quantity > targetCount) {
      const [fallbackTask] = queue;
      if (!fallbackTask) {
        return {
          tasks: [],
          totalCount: 0,
          overflowFallback: false,
        };
      }
      return {
        tasks: [fallbackTask],
        totalCount: fallbackTask.quantity,
        overflowFallback: true,
      };
    }

    const tasks: WaterTask[] = [];
    let totalCount = 0;
    for (const task of queue) {
      if (totalCount + task.quantity <= targetCount) {
        tasks.push(task);
        totalCount += task.quantity;
        continue;
      }
      // FIFO: do not skip an earlier task for later tasks.
      break;
    }

    return {
      tasks,
      totalCount,
      overflowFallback: false,
    };
  }, [waterDumplingTargetCount, waterQueuedDumplingTasks]);

  const waterQueuedDumplingTaskIdSet = useMemo(
    () => new Set(waterQueuedDumplingTasks.map((task) => task.taskId)),
    [waterQueuedDumplingTasks],
  );

  useEffect(() => {
    setWaterDumplingCapturedTaskIds((prev) => {
      const next = prev.filter((taskId) => waterQueuedDumplingTaskIdSet.has(taskId));
      return next.length === prev.length ? prev : next;
    });
  }, [waterQueuedDumplingTaskIdSet]);

  const waterCapturedDumplingTasks = useMemo(
    () =>
      waterDumplingCapturedTaskIds
        .map((taskId) => waterTaskMap.get(taskId))
        .filter(
          (task): task is WaterTask =>
            task !== undefined &&
            task.type === 'dumpling' &&
            getWaterTaskProgress(task.taskId).status === 'queued',
        ),
    [waterDumplingCapturedTaskIds, waterTaskMap, waterTaskProgress],
  );

  const summarizeWaterDumplingFlavors = (tasks: WaterTask[]) => {
    const flavorMap = new Map<string, number>();
    tasks.forEach((task) => {
      task.flavorCounts.forEach((flavor) => {
        flavorMap.set(flavor.name, (flavorMap.get(flavor.name) ?? 0) + flavor.count);
      });
    });
    return Array.from(flavorMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  const waterEstimatedDumplingFlavorSummary = useMemo(
    () => summarizeWaterDumplingFlavors(waterEstimatedDumplingBatch.tasks),
    [waterEstimatedDumplingBatch],
  );

  const waterCapturedDumplingFlavorSummary = useMemo(
    () => summarizeWaterDumplingFlavors(waterCapturedDumplingTasks),
    [waterCapturedDumplingTasks],
  );

  const waterEstimatedDumplingTaskCount = waterEstimatedDumplingBatch.tasks.length;
  const waterCapturedDumplingTaskCount = waterCapturedDumplingTasks.length;
  const waterCapturedDumplingCount = useMemo(
    () => waterCapturedDumplingTasks.reduce((sum, task) => sum + task.quantity, 0),
    [waterCapturedDumplingTasks],
  );

  const activeNoodleStationId = activeProductionStationIdByModule.noodle;
  const getWaterLadleCapacityForStation = (stationId: string | null) =>
    Math.max(
      1,
      Math.round(
        (stationId
          ? waterLadleCountByStationId[stationId]
          : undefined) ?? DEFAULT_WATER_LADLE_COUNT,
      ) || 1,
    );
  const waterLadleCapacity = getWaterLadleCapacityForStation(activeNoodleStationId);

  const waterActiveLadleSlots = useMemo(() => {
    const slots = new Set<number>();
    waterCookingTasks.forEach((task) => {
      if (!task.requiresLadle) return;
      const slot = getWaterTaskProgress(task.taskId).ladleSlot;
      if (slot !== null) slots.add(slot);
    });
    return slots;
  }, [waterCookingTasks, waterTaskProgress]);

  const waterMaxOccupiedLadleSlot = useMemo(() => {
    let maxSlot = 0;
    waterActiveLadleSlots.forEach((slot) => {
      if (slot > maxSlot) maxSlot = slot;
    });
    return maxSlot;
  }, [waterActiveLadleSlots]);

  const waterLadleBusyCount = waterActiveLadleSlots.size;
  const waterLadleIdleCount = Math.max(0, waterLadleCapacity - waterLadleBusyCount);

  const waterDumplingActiveTasks = useMemo(
    () => waterTasks
      .filter((task) => task.type === 'dumpling')
      .filter((task) => isWaterTaskAssignedToActiveStation(task))
      .filter((task) => getWaterTaskProgress(task.taskId).status !== 'done'),
    [activeProductionStationIdByModule, waterTaskProgress, waterTasks, waterTaskStationByTaskId],
  );

  const waterLadleActiveTasks = useMemo(
    () =>
      waterTasks.filter(
        (task) =>
          isWaterTaskAssignedToActiveStation(task) &&
          task.requiresLadle &&
          getWaterTaskProgress(task.taskId).status !== 'done',
      ),
    [activeProductionStationIdByModule, waterTaskProgress, waterTasks, waterTaskStationByTaskId],
  );

  const waterUnlockedTaskIdSet = useMemo(
    () => new Set(waterUnlockedTaskIds),
    [waterUnlockedTaskIds],
  );

  const waterDumplingQueuedPieces = useMemo(
    () =>
      waterQueuedTasks
        .filter((task) => task.type === 'dumpling')
        .reduce((sum, task) => sum + task.quantity, 0),
    [waterQueuedTasks],
  );

  const waterDumplingCookingPieces = useMemo(
    () =>
      waterCookingTasks
        .filter((task) => task.type === 'dumpling')
        .reduce((sum, task) => sum + task.quantity, 0),
    [waterCookingTasks],
  );

  useEffect(() => {
    const activeWaterSection = productionSection === 'noodle' ? 'noodle' : 'dumpling';
    const hasDoneInActiveTab =
      productionSection === 'dumpling'
        ? waterDoneTasks.some((task) => task.type === 'dumpling')
        : productionSection === 'noodle'
          ? waterDoneTasks.some((task) => task.requiresLadle)
          : true;
    if (!hasDoneInActiveTab) {
      setShowWaterCompletedPanelBySection((prev) =>
        prev[activeWaterSection]
          ? { ...prev, [activeWaterSection]: false }
          : prev,
      );
    }
  }, [productionSection, waterDoneTasks]);

  useEffect(() => {
    const activeTaskIdSet = new Set(waterLadleActiveTasks.map((task) => task.taskId));
    setWaterUnlockedTaskIds((prev) => {
      const next = prev.filter((taskId) => activeTaskIdSet.has(taskId));
      return next.length === prev.length ? prev : next;
    });
  }, [waterLadleActiveTasks]);

  useEffect(() => {
    setSelectedWaterTransferTaskId((prev) => {
      if (!prev) return prev;
      const task = waterTaskMap.get(prev);
      if (!task || !task.requiresLadle) return null;
      const progress = getWaterTaskProgress(prev);
      if (progress.status === 'queued') return prev;
      if (progress.status === 'cooking' && waterUnlockedTaskIdSet.has(prev)) return prev;
      return null;
    });
  }, [waterTaskMap, waterTaskProgress, waterUnlockedTaskIdSet]);

  const waterLadleSlots = useMemo(
    () => Array.from({ length: waterLadleCapacity }, (_, index) => index + 1),
    [waterLadleCapacity],
  );

  const waterCookingTaskByLadleSlot = useMemo(() => {
    const map = new Map<number, WaterTask>();
    waterCookingTasks.forEach((task) => {
      if (!task.requiresLadle) return;
      const slot = getWaterTaskProgress(task.taskId).ladleSlot;
      if (slot !== null) map.set(slot, task);
    });
    return map;
  }, [waterCookingTasks, waterTaskProgress]);

  const hasActiveFryTimer = useMemo(
    () => FRY_STATION_ORDER.some((stationId) => Boolean(fryStations[stationId].lockedBatch?.timerStartedAt)),
    [fryStations],
  );

  const hasActiveWaterTimer = useMemo(
    () => waterCookingTasksAll.some((task) => Boolean(getWaterTaskProgress(task.taskId).startedAt)),
    [waterCookingTasksAll, waterTaskProgress],
  );

  useEffect(() => {
    if (!hasActiveFryTimer && !hasActiveWaterTimer) return;

    const timer = window.setInterval(() => {
      setFryTimerNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasActiveFryTimer, hasActiveWaterTimer]);

  const toggleFryPreviewPanel = (panel: FryPreviewPanel) => {
    setActiveFryPreviewPanel((prev) => (prev === panel ? null : panel));
  };

  const recomputeFryRecommendations = () => {
    setFryRecalcVersion((prev) => prev + 1);
  };

  const formatOrderId = (sequence: number) => {
    return `B${String(sequence).padStart(3, '0')}`;
  };

  const persistWorkflowOrder = (
    order: SubmittedOrder,
    status: 'waiting_pickup' | 'served' | 'archived',
    source: 'customer' | 'ingest' = 'customer',
  ) => {
    void backofficeApi.upsertOrderRecord({
      storeId: authUser.storeId,
      orderId: order.id,
      source,
      status,
      serviceMode: order.serviceMode,
      totalAmount: order.totalAmount,
      totalCount: order.totalCount,
      createdAt: order.createdAt,
      orderPayload: {
        ...order,
        status,
      },
    }).catch(() => undefined);
  };

  const findWorkflowOrder = (orderId: string) =>
    packagingOrders.find((entry) => entry.id === orderId)
    ?? productionOrders.find((entry) => entry.id === orderId)
    ?? null;

  const serviceModeLabel = (mode: ServiceMode) => (mode === 'dine_in' ? '內用' : '外帶');
  const orderTimeLabel = (createdAt: number) =>
    new Date(createdAt).toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const getPackagingStatus = (orderId: string): PackagingStatus =>
    packagingStatusByOrderId[orderId] ?? 'waiting_pickup';

  const setPackagingStatus = (orderId: string, status: PackagingStatus) => {
    setPackagingStatusByOrderId((prev) =>
      prev[orderId] === status
        ? prev
        : {
          ...prev,
          [orderId]: status,
        },
    );
    const targetOrder = findWorkflowOrder(orderId);
    if (targetOrder) {
      persistWorkflowOrder(targetOrder, status, 'customer');
    }
  };

  const archiveWorkflowOrder = (orderId: string) => {
    if (archivingOrderIds.includes(orderId)) return;
    const targetOrder = findWorkflowOrder(orderId);
    if (targetOrder) {
      persistWorkflowOrder(targetOrder, 'archived', 'customer');
    }
    setArchivingOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
    if (archiveOrderTimerRef.current[orderId] !== undefined) return;

    archiveOrderTimerRef.current[orderId] = window.setTimeout(() => {
      setArchivedOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
      setProductionOrders((prev) => prev.filter((order) => order.id !== orderId));
      setPackagingOrders((prev) => prev.filter((order) => order.id !== orderId));
      setPackagingStatusByOrderId((prev) => {
        if (!(orderId in prev)) return prev;
        const rest = { ...prev };
        delete rest[orderId];
        return rest;
      });
      setPackagingItemStatusOverrides((prev) => {
        if (!(orderId in prev)) return prev;
        const rest = { ...prev };
        delete rest[orderId];
        return rest;
      });
      setWorkflowOrderNotes((prev) => {
        if (!(orderId in prev)) return prev;
        const rest = { ...prev };
        delete rest[orderId];
        return rest;
      });
      setPackagingPinnedOrderIds((prev) => prev.filter((id) => id !== orderId));
      setArchivingOrderIds((prev) => prev.filter((id) => id !== orderId));
      delete archiveOrderTimerRef.current[orderId];
    }, 260);
  };

  const updateWorkflowOrderNote = (orderId: string, note: string) => {
    const trimmed = note.slice(0, 120);
    setWorkflowOrderNotes((prev) => {
      const current = Object.prototype.hasOwnProperty.call(prev, orderId) ? prev[orderId] : undefined;
      if (current === trimmed) return prev;
      return {
        ...prev,
        [orderId]: trimmed,
      };
    });
  };

  const getOrderWorkflowNote = (order: Pick<SubmittedOrder, 'id' | 'orderNote'>) =>
    Object.prototype.hasOwnProperty.call(workflowOrderNotes, order.id)
      ? workflowOrderNotes[order.id]
      : (order.orderNote ?? '');

  const getPackagingItemEffectiveStatus = (
    orderId: string,
    item: PackagingChecklistItem,
  ): PackagingItemTrackStatus =>
    packagingItemStatusOverrides[orderId]?.[item.key] ?? item.baseStatus;

  const setPackagingItemStatus = (
    orderId: string,
    itemKey: string,
    status: PackagingItemTrackStatus,
  ) => {
    setPackagingItemStatusOverrides((prev) => {
      const orderOverrides = prev[orderId] ?? {};
      if (orderOverrides[itemKey] === status) return prev;
      return {
        ...prev,
        [orderId]: {
          ...orderOverrides,
          [itemKey]: status,
        },
      };
    });
  };

  const clearPackagingItemStatusOverride = (orderId: string, itemKey: string) => {
    setPackagingItemStatusOverrides((prev) => {
      const orderOverrides = prev[orderId];
      if (!orderOverrides || !(itemKey in orderOverrides)) return prev;
      const rest = { ...orderOverrides };
      delete rest[itemKey];
      if (Object.keys(rest).length === 0) {
        const restOrders = { ...prev };
        delete restOrders[orderId];
        return restOrders;
      }
      return {
        ...prev,
        [orderId]: rest,
      };
    });
  };

  const togglePackagingChecklistItem = (orderId: string, item: PackagingChecklistItem) => {
    const effectiveStatus = getPackagingItemEffectiveStatus(orderId, item);
    if (effectiveStatus === 'packed') {
      clearPackagingItemStatusOverride(orderId, item.key);
      return;
    }
    setPackagingItemStatus(orderId, item.key, 'packed');
  };

  const clearPackagingQueuedTapArmed = () => {
    if (packagingQueuedTapTimerRef.current !== null) {
      window.clearTimeout(packagingQueuedTapTimerRef.current);
      packagingQueuedTapTimerRef.current = null;
    }
    setPackagingQueuedTapArmedKey(null);
  };

  const armPackagingQueuedTap = (armedKey: string) => {
    if (packagingQueuedTapTimerRef.current !== null) {
      window.clearTimeout(packagingQueuedTapTimerRef.current);
    }
    setPackagingQueuedTapArmedKey(armedKey);
    packagingQueuedTapTimerRef.current = window.setTimeout(() => {
      setPackagingQueuedTapArmedKey((prev) => (prev === armedKey ? null : prev));
      packagingQueuedTapTimerRef.current = null;
    }, 900);
  };

  const pinPackagingOrderToTopQueue = (orderId: string) => {
    setPackagingPinnedOrderIds((prev) => [orderId, ...prev.filter((id) => id !== orderId)]);
  };

  const normalizePackagingTopQueueLimit = (value: number) => Math.max(1, Math.round(value));

  const applyPackagingTopQueueLimit = (value: number) => {
    const next = normalizePackagingTopQueueLimit(value);
    setPackagingTopQueueLimit(next);
    setPackagingTopQueueLimitInput(String(next));
  };

  const updatePackagingTopQueueLimitInput = (value: string) => {
    if (!/^\d*$/.test(value)) return;
    setPackagingTopQueueLimitInput(value);
    if (!value) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setPackagingTopQueueLimit(normalizePackagingTopQueueLimit(parsed));
  };

  const commitPackagingTopQueueLimitInput = () => {
    if (!packagingTopQueueLimitInput.trim()) {
      setPackagingTopQueueLimitInput(String(packagingTopQueueLimit));
      return;
    }
    const parsed = Number(packagingTopQueueLimitInput);
    if (!Number.isFinite(parsed)) {
      setPackagingTopQueueLimitInput(String(packagingTopQueueLimit));
      return;
    }
    applyPackagingTopQueueLimit(parsed);
  };

  const nudgePackagingTopQueueLimit = (delta: number) => {
    applyPackagingTopQueueLimit(packagingTopQueueLimit + delta);
  };

  useEffect(() => {
    setPackagingTopQueueLimitInput(String(packagingTopQueueLimit));
  }, [packagingTopQueueLimit]);

  const resolvePackagingDragOrderId = (event: DragEvent<HTMLElement>) => {
    const transferId =
      event.dataTransfer.getData('application/x-bafang-order-id') ||
      event.dataTransfer.getData('text/plain');
    return (packagingDraggingOrderId ?? transferId) || null;
  };

  const handlePackagingOrderDragStart = (event: DragEvent<HTMLElement>, orderId: string) => {
    if (getPackagingStatus(orderId) !== 'waiting_pickup') {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-bafang-order-id', orderId);
    event.dataTransfer.setData('text/plain', orderId);
    setPackagingDraggingOrderId(orderId);
  };

  const clearPackagingDragState = () => {
    setPackagingDraggingOrderId(null);
    setPackagingDropActive(false);
  };

  const handlePackagingTopQueueDragOver = (event: DragEvent<HTMLElement>) => {
    const orderId = resolvePackagingDragOrderId(event);
    if (!orderId || getPackagingStatus(orderId) !== 'waiting_pickup') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setPackagingDropActive(true);
  };

  const handlePackagingTopQueueDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const orderId = resolvePackagingDragOrderId(event);
    clearPackagingDragState();
    if (!orderId || getPackagingStatus(orderId) !== 'waiting_pickup') return;
    pinPackagingOrderToTopQueue(orderId);
  };

  const orderPackagingLaneByOrderId = useMemo(() => {
    const map = new Map<string, PackagingLaneId>();
    if (effectivePackagingStations.length === 0) return map;
    const loadByLaneId = new Map<string, number>(
      effectivePackagingStations.map((station) => [station.id, 0]),
    );
    const sortedOrders = [...packagingOrders].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );

    sortedOrders.forEach((order) => {
      const flags = buildOrderCategoryFlags(order, itemMap);
      const tags = buildOrderTagSet(order, itemMap, itemNameCategoryMap);
      const candidates = effectivePackagingStations.filter((station) =>
        filterMatchesOrder(station, flags, tags, order.serviceMode),
      );
      const lanes = candidates.length > 0 ? candidates : [effectivePackagingStations[0]];
      let pickedLane = lanes[0];
      let pickedLoad = loadByLaneId.get(pickedLane.id) ?? 0;
      lanes.slice(1).forEach((lane) => {
        const laneLoad = loadByLaneId.get(lane.id) ?? 0;
        if (laneLoad < pickedLoad) {
          pickedLane = lane;
          pickedLoad = laneLoad;
        }
      });
      map.set(order.id, pickedLane.id);

      if (getPackagingStatus(order.id) === 'waiting_pickup') {
        const orderLoad = Math.max(1, order.totalCount);
        loadByLaneId.set(pickedLane.id, pickedLoad + orderLoad);
      }
    });
    return map;
  }, [
    effectivePackagingStations,
    itemMap,
    itemNameCategoryMap,
    packagingOrders,
    packagingStatusByOrderId,
  ]);

  const getOrderPackagingLane = (orderId: string): PackagingLaneId =>
    orderPackagingLaneByOrderId.get(orderId) ?? getInitialPackagingLaneId(workflowSettings);

  const packagingOrdersSorted = useMemo(
    () =>
      [...packagingOrders]
        .filter(
          (order) =>
            getPackagingStatus(order.id) === 'waiting_pickup' &&
            getOrderPackagingLane(order.id) === activePackagingLane,
        )
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [activePackagingLane, orderPackagingLaneByOrderId, packagingOrders, packagingStatusByOrderId],
  );

  const packagingWorkflowOrdersSorted = useMemo(
    () => [...packagingOrders].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [packagingOrders],
  );

  useEffect(() => {
    const waitingOrderIdSet = new Set(
      packagingOrders
        .filter((order) => getPackagingStatus(order.id) === 'waiting_pickup')
        .map((order) => order.id),
    );
    setPackagingPinnedOrderIds((prev) => {
      const next = prev.filter((orderId) => waitingOrderIdSet.has(orderId));
      return next.length === prev.length ? prev : next;
    });
  }, [packagingOrders, packagingStatusByOrderId]);

  const packagingTopQueueOrders = useMemo(
    () => {
      const waitingOrders = [...packagingOrders]
        .filter(
          (order) =>
            getPackagingStatus(order.id) === 'waiting_pickup' &&
            getOrderPackagingLane(order.id) === activePackagingLane,
        )
        .sort(
          (a, b) =>
            a.createdAt - b.createdAt ||
            a.id.localeCompare(b.id),
        );
      const waitingOrderMap = new Map(waitingOrders.map((order) => [order.id, order]));
      const pinnedOrders = packagingPinnedOrderIds
        .map((orderId) => waitingOrderMap.get(orderId))
        .filter((order): order is SubmittedOrder => order !== undefined);
      const pinnedSet = new Set(pinnedOrders.map((order) => order.id));
      const autoOrders = waitingOrders.filter((order) => !pinnedSet.has(order.id));
      return [...pinnedOrders, ...autoOrders].slice(0, packagingTopQueueLimit);
    },
    [
      activePackagingLane,
      orderPackagingLaneByOrderId,
      packagingOrders,
      packagingPinnedOrderIds,
      packagingStatusByOrderId,
      packagingTopQueueLimit,
    ],
  );

  const packagingTopQueueOrderIdSet = useMemo(
    () => new Set(packagingTopQueueOrders.map((order) => order.id)),
    [packagingTopQueueOrders],
  );

  const packagingOtherOrders = useMemo(
    () => packagingOrdersSorted.filter((order) => !packagingTopQueueOrderIdSet.has(order.id)),
    [packagingOrdersSorted, packagingTopQueueOrderIdSet],
  );

  const packagingSearchResults = useMemo(() => {
    const keyword = packagingSearchKeyword.trim().toLowerCase();
    if (!keyword) return packagingWorkflowOrdersSorted;

    return packagingWorkflowOrdersSorted.filter((order) => {
      const statusLabel = PACKAGING_STATUS_META[getPackagingStatus(order.id)].label;
      const packagingLane = getPackagingLaneLabel(getOrderPackagingLane(order.id));
      const orderNote = getOrderWorkflowNote(order);
      const lineKeywords = order.cartLines
        .map((line) => `${line.name}${line.customLabel ? ` ${line.customLabel}` : ''}${line.note ? ` ${line.note}` : ''}`)
        .join(' ');
      const boxKeywords = order.boxRows
        .map((row) => `${row.boxLabel} ${row.items.map((item) => item.name).join(' ')}`)
        .join(' ');
      const haystack = [
        order.id,
        serviceModeLabel(order.serviceMode),
        statusLabel,
        packagingLane,
        orderNote,
        lineKeywords,
        boxKeywords,
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [
    orderPackagingLaneByOrderId,
    packagingWorkflowOrdersSorted,
    packagingSearchKeyword,
    packagingStatusByOrderId,
    workflowOrderNotes,
  ]);

  useEffect(() => {
    setExpandedWorkflowOrderId((prev) => {
      if (!prev) return prev;
      return packagingWorkflowOrdersSorted.some((order) => order.id === prev) ? prev : null;
    });
  }, [packagingWorkflowOrdersSorted]);

  const fryCookingEntryIdSet = useMemo(() => {
    const set = new Set<string>();
    FRY_STATION_ORDER.forEach((stationId) => {
      const lockedBatch = fryStations[stationId].lockedBatch;
      if (!lockedBatch?.timerStartedAt) return;
      lockedBatch.entryIds.forEach((entryId) => set.add(entryId));
    });
    return set;
  }, [fryStations]);

  const fryEntryIdsByOrderId = useMemo(() => {
    const map = new Map<string, string[]>();
    fryQueueEntries.forEach((entry) => {
      const bucket = map.get(entry.orderId);
      if (bucket) {
        bucket.push(entry.entryId);
        return;
      }
      map.set(entry.orderId, [entry.entryId]);
    });
    return map;
  }, [fryQueueEntries]);

  const waterTaskStatusByTaskId = useMemo(() => {
    const map = new Map<string, WaterTaskStatus>();
    waterTasks.forEach((task) => {
      map.set(task.taskId, getWaterTaskProgress(task.taskId).status);
    });
    return map;
  }, [waterTaskProgress, waterTasks]);

  const fryRemainingSecondsByEntryId = useMemo(() => {
    const map = new Map<string, number>();
    FRY_STATION_ORDER.forEach((stationId) => {
      const lockedBatch = fryStations[stationId].lockedBatch;
      if (!lockedBatch?.timerStartedAt) return;
      const elapsedSeconds = Math.floor((fryTimerNow - lockedBatch.timerStartedAt) / 1000);
      const fryDurationSeconds = Math.max(1, lockedBatch.durationSeconds || FRY_BATCH_SECONDS);
      const remainingSeconds = Math.max(0, fryDurationSeconds - elapsedSeconds);
      lockedBatch.entryIds.forEach((entryId) => {
        map.set(entryId, remainingSeconds);
      });
    });
    return map;
  }, [fryStations, fryTimerNow]);

  const fryProgressPercentByEntryId = useMemo(() => {
    const map = new Map<string, number>();
    FRY_STATION_ORDER.forEach((stationId) => {
      const lockedBatch = fryStations[stationId].lockedBatch;
      if (!lockedBatch?.timerStartedAt) return;
      const elapsedSeconds = Math.max(0, (fryTimerNow - lockedBatch.timerStartedAt) / 1000);
      const fryDurationSeconds = Math.max(1, lockedBatch.durationSeconds || FRY_BATCH_SECONDS);
      const progressPercent = Math.max(
        0,
        Math.min(100, (elapsedSeconds / fryDurationSeconds) * 100),
      );
      lockedBatch.entryIds.forEach((entryId) => {
        map.set(entryId, progressPercent);
      });
    });
    return map;
  }, [fryStations, fryTimerNow]);

  const waterRemainingSecondsByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    waterTasks.forEach((task) => {
      const progress = getWaterTaskProgress(task.taskId);
      if (progress.status !== 'cooking' || !progress.startedAt) return;
      const elapsedSeconds = Math.floor((fryTimerNow - progress.startedAt) / 1000);
      const remainingSeconds = Math.max(0, task.durationSeconds - elapsedSeconds);
      map.set(task.taskId, remainingSeconds);
    });
    return map;
  }, [fryTimerNow, waterTaskProgress, waterTasks]);

  const waterProgressPercentByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    waterTasks.forEach((task) => {
      const progress = getWaterTaskProgress(task.taskId);
      if (progress.status !== 'cooking' || !progress.startedAt) return;
      const elapsedSeconds = Math.max(0, (fryTimerNow - progress.startedAt) / 1000);
      const progressPercent = Math.max(
        0,
        Math.min(100, (elapsedSeconds / Math.max(1, task.durationSeconds)) * 100),
      );
      map.set(task.taskId, progressPercent);
    });
    return map;
  }, [fryTimerNow, waterTaskProgress, waterTasks]);

  const packagingChecklistByOrderId = useMemo(() => {
    const map = new Map<string, PackagingChecklistItem[]>();

    const aggregateWaterStatus = (
      taskIds: string[],
    ): { status: PackagingItemTrackStatus; etaSeconds: number | null; progressPercent: number | null } => {
      if (taskIds.length === 0) {
        return { status: 'issue', etaSeconds: null, progressPercent: null };
      }
      const statuses = taskIds
        .map((taskId) => waterTaskStatusByTaskId.get(taskId))
        .filter((status): status is WaterTaskStatus => status !== undefined);
      if (statuses.length === 0) {
        return { status: 'issue', etaSeconds: null, progressPercent: null };
      }
      if (statuses.every((status) => status === 'done')) {
        return { status: 'ready', etaSeconds: 0, progressPercent: 100 };
      }
      if (statuses.some((status) => status === 'cooking')) {
        const cookingEta = taskIds
          .map((taskId) => waterRemainingSecondsByTaskId.get(taskId))
          .filter((seconds): seconds is number => seconds !== undefined);
        const progressValues = taskIds
          .map((taskId) => waterProgressPercentByTaskId.get(taskId))
          .filter((percent): percent is number => percent !== undefined);
        return {
          status: 'in_progress',
          etaSeconds: cookingEta.length > 0 ? Math.max(...cookingEta) : null,
          progressPercent: progressValues.length > 0
            ? progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length
            : null,
        };
      }
      if (statuses.some((status) => status === 'queued')) {
        return { status: 'queued', etaSeconds: null, progressPercent: 0 };
      }
      return { status: 'issue', etaSeconds: null, progressPercent: null };
    };

    const aggregateFryStatus = (
      entryIds: string[],
    ): { status: PackagingItemTrackStatus; etaSeconds: number | null; progressPercent: number | null } => {
      if (entryIds.length === 0) {
        return { status: 'issue', etaSeconds: null, progressPercent: null };
      }
      if (entryIds.every((entryId) => friedEntryIdSet.has(entryId))) {
        return { status: 'ready', etaSeconds: 0, progressPercent: 100 };
      }
      if (entryIds.some((entryId) => fryCookingEntryIdSet.has(entryId))) {
        const cookingEta = entryIds
          .filter((entryId) => fryCookingEntryIdSet.has(entryId))
          .map((entryId) => fryRemainingSecondsByEntryId.get(entryId))
          .filter((seconds): seconds is number => seconds !== undefined);
        const progressValues = entryIds
          .filter((entryId) => fryCookingEntryIdSet.has(entryId))
          .map((entryId) => fryProgressPercentByEntryId.get(entryId))
          .filter((percent): percent is number => percent !== undefined);
        return {
          status: 'in_progress',
          etaSeconds: cookingEta.length > 0 ? Math.max(...cookingEta) : null,
          progressPercent: progressValues.length > 0
            ? progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length
            : null,
        };
      }
      return { status: 'queued', etaSeconds: null, progressPercent: 0 };
    };

    const createChecklistItem = (
      input: {
        key: string;
        categoryKey: string;
        categoryLabel: string;
        groupKey?: string;
        groupLabel: string;
        partLabel?: string;
        label: string;
        quantity: number;
        quantityUnit?: string;
        detail?: string;
        showServiceModeTag?: boolean;
        source: PackagingChecklistItem['source'];
        note?: string;
      },
      track: {
        status: PackagingItemTrackStatus;
        etaSeconds: number | null;
        progressPercent: number | null;
      },
    ): PackagingChecklistItem => {
      return {
        key: input.key,
        categoryKey: input.categoryKey,
        categoryLabel: input.categoryLabel,
        groupKey: input.groupKey ?? input.key,
        groupLabel: input.groupLabel,
        partLabel: input.partLabel,
        label: input.label,
        quantity: input.quantity,
        quantityUnit: input.quantityUnit,
        detail: input.detail,
        showServiceModeTag: input.showServiceModeTag,
        baseStatus: track.status,
        etaSeconds: track.etaSeconds,
        progressPercent: track.progressPercent,
        source: input.source,
        note: input.note,
      };
    };

    const directReadyTrack = {
      status: 'ready' as PackagingItemTrackStatus,
      etaSeconds: 0,
      progressPercent: 100,
    };

    packagingOrders.forEach((order) => {
      const items: PackagingChecklistItem[] = [];
      const fryEntryIds = fryEntryIdsByOrderId.get(order.id) ?? [];

      order.boxRows.forEach((row) => {
        const quantity = row.items.reduce((sum, item) => sum + item.count, 0);
        if (quantity <= 0) return;

        if (row.id.startsWith('potsticker-')) {
          const prepStationCandidates = row.items
            .map((entry) => itemNameCategoryMap.get(`potsticker:${entry.name}`.toLowerCase())?.prepStation)
            .filter((station): station is PrepStation => station !== undefined);
          const prepStation = prepStationCandidates.find((station) => station !== 'none') ?? 'none';
          const flavorDetail = row.items
            .map((entry) => `${normalizePotstickerFlavorName(entry.name)} ${entry.count}顆`)
            .join(' · ');
          const isGriddle = prepStation === 'griddle';
          const track = isGriddle ? aggregateFryStatus(fryEntryIds) : directReadyTrack;
          items.push(createChecklistItem({
            key: `box:${row.id}`,
            categoryKey: 'potsticker',
            categoryLabel: '鍋貼',
            groupKey: 'box-group:potsticker',
            groupLabel: row.boxLabel,
            partLabel: flavorDetail,
            label: flavorDetail,
            quantity: 1,
            quantityUnit: '盒',
            detail: row.boxLabel,
            showServiceModeTag: true,
            source: isGriddle ? 'griddle' : 'direct',
          }, track));
          return;
        }

        if (row.id.startsWith('dumpling-')) {
          const prepStationCandidates = row.items
            .map((entry) => itemNameCategoryMap.get(`dumpling:${entry.name}`.toLowerCase())?.prepStation)
            .filter((station): station is PrepStation => station !== undefined);
          const prepStation = prepStationCandidates.find((station) => station !== 'none') ?? 'none';
          const taskId = `${order.id}::water:dumpling-box:${row.id}`;
          const flavorDetail = row.items
            .map((entry) => `${normalizeDumplingFlavorName(entry.name)} ${entry.count}顆`)
            .join(' · ');
          const isWater = prepStation === 'dumpling';
          const track = isWater ? aggregateWaterStatus([taskId]) : directReadyTrack;
          items.push(createChecklistItem({
            key: `box:${row.id}`,
            categoryKey: 'dumpling',
            categoryLabel: '水餃',
            groupKey: 'box-group:dumpling',
            groupLabel: row.boxLabel,
            partLabel: flavorDetail,
            label: flavorDetail,
            quantity: 1,
            quantityUnit: '盒',
            detail: row.boxLabel,
            source: isWater ? 'water' : 'direct',
          }, track));
        }
      });

      order.cartLines.forEach((line) => {
        const item = itemMap.get(line.menuItemId);
        if (!item) return;
        const lineLabel = `${line.name}${line.customLabel ? ` · ${line.customLabel}` : ''}`;
        const prepStation = item.prepStation;

        if (item.category === 'potsticker') {
          const isGriddle = prepStation === 'griddle';
          const track = isGriddle ? aggregateFryStatus(fryEntryIds) : directReadyTrack;
          items.push(createChecklistItem({
            key: `line:${line.id}`,
            categoryKey: 'potsticker',
            categoryLabel: '鍋貼',
            groupLabel: lineLabel,
            label: lineLabel,
            quantity: line.quantity,
            showServiceModeTag: true,
            source: isGriddle ? 'griddle' : 'direct',
            note: line.note,
          }, track));
          return;
        }

        if (item.category === 'dumpling') {
          const taskId = `${order.id}::water:dumpling-line:${line.id}`;
          const isWater = prepStation === 'dumpling';
          const track = isWater ? aggregateWaterStatus([taskId]) : directReadyTrack;
          items.push(createChecklistItem({
            key: `line:${line.id}`,
            categoryKey: 'dumpling',
            categoryLabel: '水餃',
            groupLabel: lineLabel,
            label: lineLabel,
            quantity: line.quantity,
            source: isWater ? 'water' : 'direct',
            note: line.note,
          }, track));
          return;
        }

        if (item.category === 'soup_dumpling') {
          const taskId = `${order.id}::water:soup-dumpling:${line.id}`;
          const groupKey = `line:${line.id}`;
          const isWater = prepStation === 'dumpling';
          const track = isWater ? aggregateWaterStatus([taskId]) : directReadyTrack;
          items.push(createChecklistItem({
            key: `${groupKey}:dumpling`,
            categoryKey: 'soup_dumpling',
            categoryLabel: '湯餃',
            groupKey,
            groupLabel: lineLabel,
            partLabel: '水餃',
            label: `${lineLabel}（水餃）`,
            quantity: line.quantity,
            source: isWater ? 'water' : 'direct',
            note: line.note,
          }, track));
          items.push(createChecklistItem({
            key: `${groupKey}:soup`,
            categoryKey: 'soup_dumpling',
            categoryLabel: '湯餃',
            groupKey,
            groupLabel: lineLabel,
            partLabel: '湯',
            label: `${lineLabel}（湯）`,
            quantity: line.quantity,
            showServiceModeTag: true,
            source: 'direct',
            note: line.note,
          }, track));
          return;
        }

        if (item.category === 'noodle') {
          const taskId = `${order.id}::water:noodle:${line.id}`;
          const isWater = prepStation === 'noodle';
          const track = isWater ? aggregateWaterStatus([taskId]) : directReadyTrack;
          const isDryNoodle = item.name.includes('乾麵');
          const groupKey = `line:${line.id}`;
          items.push(createChecklistItem({
            key: `${groupKey}:noodle`,
            categoryKey: 'noodle',
            categoryLabel: '麵類',
            groupKey,
            groupLabel: lineLabel,
            partLabel: isDryNoodle ? undefined : '麵',
            label: `${lineLabel}${isDryNoodle ? '' : '（麵）'}`,
            quantity: line.quantity,
            source: isWater ? 'water' : 'direct',
            note: line.note,
          }, track));
          if (!isDryNoodle) {
            items.push(createChecklistItem({
              key: `${groupKey}:soup`,
              categoryKey: 'noodle',
              categoryLabel: '麵類',
              groupKey,
              groupLabel: lineLabel,
              partLabel: '湯',
              label: `${lineLabel}（湯）`,
              quantity: line.quantity,
              showServiceModeTag: true,
              source: 'direct',
              note: line.note,
            }, track));
          }
          return;
        }

        if (item.category === 'side') {
          const taskId = `${order.id}::water:side-heat:${line.id}`;
          const isWater = prepStation === 'noodle';
          const track = isWater ? aggregateWaterStatus([taskId]) : directReadyTrack;
          items.push(createChecklistItem({
            key: `line:${line.id}`,
            categoryKey: 'side',
            categoryLabel: '小菜',
            groupLabel: lineLabel,
            label: lineLabel,
            quantity: line.quantity,
            source: isWater ? 'water' : 'direct',
            note: line.note,
          }, track));
          return;
        }

        if (item.category === 'soup_drink') {
          const taskId = `${order.id}::water:soup-drink:${line.id}`;
          const isWater = prepStation === 'noodle';
          const track = isWater ? aggregateWaterStatus([taskId]) : directReadyTrack;
          const isSoupItem = item.unit === '碗';
          items.push(createChecklistItem({
            key: `line:${line.id}`,
            categoryKey: isSoupItem ? 'soup' : 'drink',
            categoryLabel: isSoupItem ? '湯品' : '飲品',
            groupLabel: lineLabel,
            label: lineLabel,
            quantity: line.quantity,
            showServiceModeTag: isSoupItem,
            source: isWater ? 'water' : 'direct',
            note: line.note,
          }, track));
        }
      });

      map.set(order.id, items);
    });

    return map;
  }, [
    friedEntryIdSet,
    fryCookingEntryIdSet,
    fryEntryIdsByOrderId,
    fryProgressPercentByEntryId,
    fryRemainingSecondsByEntryId,
    itemMap,
    itemNameCategoryMap,
    packagingOrders,
    waterProgressPercentByTaskId,
    waterRemainingSecondsByTaskId,
    waterTaskStatusByTaskId,
  ]);

  useEffect(() => {
    setPackagingItemStatusOverrides((prev) => {
      const next: Record<string, Record<string, PackagingItemTrackStatus>> = {};
      let changed = false;

      packagingOrders.forEach((order) => {
        const currentOrderOverrides = prev[order.id];
        if (!currentOrderOverrides) return;
        const checklist = packagingChecklistByOrderId.get(order.id) ?? [];
        const validKeys = new Set(checklist.map((item) => item.key));
        const filteredEntries = Object.entries(currentOrderOverrides).filter(([key]) => validKeys.has(key));
        if (filteredEntries.length !== Object.keys(currentOrderOverrides).length) changed = true;
        if (filteredEntries.length === 0) return;
        next[order.id] = Object.fromEntries(filteredEntries);
      });

      if (!changed) {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length !== nextKeys.length) {
          changed = true;
        } else {
          for (const key of prevKeys) {
            const prevOrder = prev[key];
            const nextOrder = next[key];
            if (!nextOrder) {
              changed = true;
              break;
            }
            const prevOrderKeys = Object.keys(prevOrder);
            const nextOrderKeys = Object.keys(nextOrder);
            if (prevOrderKeys.length !== nextOrderKeys.length) {
              changed = true;
              break;
            }
            for (const entryKey of prevOrderKeys) {
              if (prevOrder[entryKey] !== nextOrder[entryKey]) {
                changed = true;
                break;
              }
            }
            if (changed) break;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [packagingChecklistByOrderId, packagingOrders]);

  const totalCount = useMemo(
    () =>
      cart.reduce((sum, line) => sum + line.quantity, 0) +
      boxSummary.reduce((sum, row) => sum + row.items.reduce((boxSum, item) => boxSum + item.count, 0), 0),
    [boxSummary, cart],
  );

  const soupSurchargeRows = useMemo(
    () => cart.filter((line) => (line.soupSurchargePerUnit ?? 0) > 0),
    [cart],
  );

  const getMenuAvailability = (itemId: string): MenuAvailabilityState =>
    menuAvailabilityById.get(itemId) ?? {
      directSoldOut: true,
      dependencySoldOut: true,
      unavailable: true,
      blockingDependencyIds: [],
    };

  const isMenuItemUnavailable = (itemId: string) => getMenuAvailability(itemId).unavailable;

  const resetConfigurator = () => {
    setExpandedConfigItemId(null);
    setConfigTofuSauce('麻醬');
    setConfigNoodleStaple('麵條');
    setConfigSoupFlavorId(availableDumplingFlavors[0]?.id ?? '');
    setConfigQuantity(1);
    setConfigNote('');
  };

  const flashAddedMenu = (menuItemId: string) => {
    setRecentlyAdded(null);
    window.setTimeout(() => {
      setRecentlyAdded({ id: menuItemId, stamp: Date.now(), phase: 'pulse' });
    }, 0);
  };

  const upsertLine = (next: CartLine) => {
    setCart((prev) => {
      const targetIndex = prev.findIndex((line) => line.mergeKey === next.mergeKey);
      if (targetIndex === -1) return [...prev, next];
      return prev.map((line, index) =>
        index === targetIndex ? { ...line, quantity: line.quantity + next.quantity } : line,
      );
    });
  };

  const addSimpleItem = (item: MenuItem, quantity = 1, note?: string) => {
    if (isMenuItemUnavailable(item.id)) return;
    const normalizedNote = note?.trim() ?? '';
    upsertLine({
      id: createId(),
      mergeKey: normalizedNote ? `${item.id}|note:${normalizedNote}` : item.id,
      menuItemId: item.id,
      name: item.name,
      unitLabel: item.unit,
      unitPrice: item.price,
      quantity,
      ...(normalizedNote ? { note: normalizedNote } : {}),
    });
    flashAddedMenu(item.id);
  };

  const toggleInlineConfigurator = (item: MenuItem) => {
    if (isMenuItemUnavailable(item.id)) return;
    setExpandedConfigItemId((prev) => (prev === item.id ? null : item.id));
    setConfigTofuSauce('麻醬');
    setConfigNoodleStaple('麵條');
    setConfigSoupFlavorId(availableDumplingFlavors[0]?.id ?? '');
    setConfigQuantity(1);
    setConfigNote('');
  };

  const buildLineFromOptions = (
    item: MenuItem,
    quantity: number,
    options?: {
      tofuSauce?: TofuSauce;
      noodleStaple?: NoodleStaple;
      soupFlavorId?: string;
      note?: string;
    },
  ) => {
    const normalizedNote = options?.note?.trim() ?? '';
    const noteMergeSuffix = normalizedNote ? `|note:${normalizedNote}` : '';

    if (item.optionType === 'tofu_sauce') {
      const sauce = options?.tofuSauce ?? '麻醬';
      return {
        id: createId(),
        mergeKey: `${item.id}|sauce:${sauce}${noteMergeSuffix}`,
        menuItemId: item.id,
        name: item.name,
        unitLabel: item.unit,
        unitPrice: item.price,
        quantity,
        customLabel: sauce,
        ...(normalizedNote ? { note: normalizedNote } : {}),
      } satisfies CartLine;
    }

    if (item.optionType === 'noodle_staple') {
      const staple = options?.noodleStaple ?? '麵條';
      return {
        id: createId(),
        mergeKey: `${item.id}|staple:${staple}${noteMergeSuffix}`,
        menuItemId: item.id,
        name: item.name,
        unitLabel: item.unit,
        unitPrice: item.price,
        quantity,
        customLabel: staple,
        ...(normalizedNote ? { note: normalizedNote } : {}),
      } satisfies CartLine;
    }

    if (item.optionType === 'soup_dumpling_flavor') {
      const baseFlavorPrice = item.baseDumplingPrice ?? 7;
      const fallbackFlavor = {
        id: 'fallback-dumpling',
        name: '基準水餃',
        price: baseFlavorPrice,
      };
      const flavor =
        availableDumplingFlavors.find((entry) => entry.id === (options?.soupFlavorId ?? configSoupFlavorId)) ??
        availableDumplingFlavors[0] ??
        fallbackFlavor;
      const dumplingCount = item.fixedDumplingCount ?? 8;
      const surcharge = Math.max(0, dumplingCount * (flavor.price - baseFlavorPrice));
      return {
        id: createId(),
        mergeKey: `${item.id}|soupFlavor:${flavor.id}${noteMergeSuffix}`,
        menuItemId: item.id,
        name: item.name,
        unitLabel: item.unit,
        unitPrice: item.price + surcharge,
        quantity,
        customLabel: `${flavor.name}（${dumplingCount}顆）`,
        ...(normalizedNote ? { note: normalizedNote } : {}),
        soupSurchargePerUnit: surcharge,
        soupFlavorName: flavor.name,
        soupFlavorPrice: flavor.price,
        soupBaseFlavorPrice: baseFlavorPrice,
        soupDumplingCount: dumplingCount,
      } satisfies CartLine;
    }

    return {
      id: createId(),
      mergeKey: `${item.id}${noteMergeSuffix}`,
      menuItemId: item.id,
      name: item.name,
      unitLabel: item.unit,
      unitPrice: item.price,
      quantity,
      ...(normalizedNote ? { note: normalizedNote } : {}),
    } satisfies CartLine;
  };

  const randomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const pickRandom = <T,>(items: T[]) => items[randomInt(0, items.length - 1)];

  const randomSoupFlavorId = () => {
    if (availableDumplingFlavors.length === 0) return '';
    const roll = Math.random();
    const shrimp = availableDumplingFlavors.find((item) => item.name.includes('鮮蝦'));
    const veggie = availableDumplingFlavors.find((item) => item.name.includes('蔬'));
    if (roll < 0.12 && shrimp) return shrimp.id;
    if (roll < 0.24 && veggie) return veggie.id;
    return pickRandom(availableDumplingFlavors.slice(0, Math.min(5, availableDumplingFlavors.length))).id;
  };
  const randomOrderNote = () => (Math.random() < 0.28 ? pickRandom(ORDER_NOTE_SAMPLES) : '');

  const buildRandomBoxRow = (
    type: BoxOrderCategory,
    boxIndex: number,
    capacityChoices: number[],
  ): SubmittedOrder['boxRows'][number] => {
    const pool = availableFillingItems[type];
    if (pool.length === 0) {
      return {
        id: `${type}-${createId()}`,
        boxLabel: `盒 ${boxIndex} · 0入`,
        typeLabel: type === 'potsticker' ? '鍋貼盒' : '水餃盒',
        items: [],
        subtotal: 0,
      };
    }
    const capacity = pickRandom(capacityChoices);
    const flavorCount = Math.min(pool.length, randomInt(1, Math.min(3, pool.length)));
    const pickedFlavors = [...pool]
      .sort(() => Math.random() - 0.5)
      .slice(0, flavorCount);
    const counts = Array.from({ length: flavorCount }, () => 1);
    let remaining = Math.max(0, capacity - flavorCount);

    while (remaining > 0) {
      const targetIndex = randomInt(0, counts.length - 1);
      counts[targetIndex] += 1;
      remaining -= 1;
    }

    const items = pickedFlavors.map((item, index) => {
      const count = counts[index];
      const subtotal = item.price * count;
      return {
        name: item.name,
        count,
        unitPrice: item.price,
        subtotal,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

    return {
      id: `${type}-${createId()}`,
      boxLabel: `盒 ${boxIndex} · ${capacity}入`,
      typeLabel: type === 'potsticker' ? '鍋貼盒' : '水餃盒',
      items,
      subtotal,
    };
  };

  const buildRandomSubmittedOrder = (sequence: number, createdAt: number): SubmittedOrder => {
    const lineMap = new Map<string, CartLine>();
    const boxRows: SubmittedOrder['boxRows'] = [];

    const addLine = (item: MenuItem, quantity: number) => {
      if (quantity <= 0) return;
      const line = buildLineFromOptions(item, quantity, {
        tofuSauce: Math.random() < 0.5 ? '麻醬' : '蠔油',
        noodleStaple: Math.random() < 0.72 ? '麵條' : '冬粉',
        soupFlavorId: randomSoupFlavorId(),
      });
      const existing = lineMap.get(line.mergeKey);
      if (existing) {
        lineMap.set(line.mergeKey, {
          ...existing,
          quantity: existing.quantity + line.quantity,
        });
        return;
      }
      lineMap.set(line.mergeKey, line);
    };

    const addFromPool = (pool: MenuItem[], quantityMin: number, quantityMax: number) => {
      if (pool.length === 0) return;
      const item = pickRandom(pool);
      const quantity = randomInt(quantityMin, quantityMax);
      addLine(item, quantity);
    };

    const addBox = (type: BoxOrderCategory, capacityChoices: number[]) => {
      if (availableFillingItems[type].length === 0) return;
      const currentBoxCount = boxRows.filter((row) => row.id.startsWith(`${type}-`)).length;
      boxRows.push(buildRandomBoxRow(type, currentBoxCount + 1, capacityChoices));
    };

    const scenarioRoll = Math.random();

    if (scenarioRoll < 0.14) {
      if (Math.random() < 0.75) {
        addFromPool(quickMenuPools.soupOnly, 1, Math.random() < 0.2 ? 2 : 1);
      } else {
        addFromPool(quickMenuPools.drinkOnly, 1, Math.random() < 0.16 ? 2 : 1);
      }
    } else if (scenarioRoll < 0.52) {
      const mainRoll = Math.random();
      if (mainRoll < 0.24) addBox('potsticker', [5, 10]);
      else if (mainRoll < 0.4) addBox('dumpling', [5, 10]);
      else if (mainRoll < 0.7) addFromPool(quickMenuPools.noodle, 1, 1);
      else addFromPool(quickMenuPools.soupDumpling, 1, 1);

      if (Math.random() < 0.36) addFromPool(quickMenuPools.side, 1, 1);
      if (Math.random() < 0.48) addFromPool(quickMenuPools.soupDrink, 1, 1);
    } else if (scenarioRoll < 0.84) {
      addBox('potsticker', [10, 12, 15]);
      if (Math.random() < 0.42) addBox('dumpling', [10, 12]);
      if (Math.random() < 0.44) addFromPool(quickMenuPools.noodle, 1, 2);
      addFromPool(quickMenuPools.side, 1, Math.random() < 0.2 ? 2 : 1);
      addFromPool(quickMenuPools.soupDrink, 1, 2);
    } else {
      const potBoxCount = randomInt(1, 2);
      const dumplingBoxCount = randomInt(0, 2);
      for (let index = 0; index < potBoxCount; index += 1) {
        addBox('potsticker', [12, 15, 20]);
      }
      for (let index = 0; index < dumplingBoxCount; index += 1) {
        addBox('dumpling', [10, 12, 15]);
      }
      for (let index = 0; index < randomInt(1, 3); index += 1) {
        addFromPool(quickMenuPools.noodle, 1, 1);
      }
      for (let index = 0; index < randomInt(1, 3); index += 1) {
        addFromPool(quickMenuPools.side, 1, 1);
      }
      addFromPool(quickMenuPools.soupDrink, 2, 4);
    }

    if (lineMap.size === 0 && boxRows.length === 0) {
      addFromPool(quickMenuPools.soupOnly, 1, 1);
    }

    const cartLines = Array.from(lineMap.values());
    const totalAmount =
      cartLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) +
      boxRows.reduce((sum, row) => sum + row.subtotal, 0);
    const totalCount =
      cartLines.reduce((sum, line) => sum + line.quantity, 0) +
      boxRows.reduce((sum, row) => sum + row.items.reduce((boxSum, item) => boxSum + item.count, 0), 0);
    const orderNote = randomOrderNote();

    return {
      id: formatOrderId(sequence),
      createdAt,
      serviceMode: Math.random() < 0.58 ? 'dine_in' : 'takeout',
      totalAmount,
      totalCount,
      ...(orderNote ? { orderNote } : {}),
      cartLines,
      boxRows,
    };
  };

  const generateSeedOrders = () => {
    const parsedCount = Number(seedOrderInput);
    if (!Number.isFinite(parsedCount)) return;
    const count = Math.max(1, Math.min(30, Math.round(parsedCount)));
    const now = Date.now();

    const snapshots = Array.from({ length: count }, (_, index) =>
      buildRandomSubmittedOrder(orderSequence + index, now - (count - index) * 35_000),
    );
    const prepend = [...snapshots].reverse();

    setProductionOrders((prev) => [...prepend, ...prev]);
    setPackagingOrders((prev) => [...prepend, ...prev]);
    setOrderSequence((prev) => prev + count);
    setSeedOrderInput(String(count));
    setSeedOrdersNotice({
      count,
      stamp: Date.now(),
      phase: 'show',
    });
  };

  const confirmConfigurator = (item: MenuItem) => {
    if (isMenuItemUnavailable(item.id)) return;
    const quantity = Math.max(1, Math.min(MAX_CONFIG_QUANTITY, Math.round(configQuantity)));
    const line = buildLineFromOptions(item, quantity, {
      tofuSauce: configTofuSauce,
      noodleStaple: configNoodleStaple,
      soupFlavorId: configSoupFlavorId,
      note: configNote,
    });
    upsertLine(line);
    flashAddedMenu(item.id);
    resetConfigurator();
  };

  const updateLineQuantity = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) =>
          line.id === lineId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const removeLine = (lineId: string) => {
    setCart((prev) => prev.filter((line) => line.id !== lineId));
  };

  const clearAllOrders = () => {
    const initial = createInitialBoxState();
    setCart([]);
    setCartOrderNote('');
    setBoxState(initial.boxes);
    setActiveBoxState(initial.active);
    setBoxReminder(null);
    setDockingAddButton(null);
    setFastTapHint(null);
    resetConfigurator();
  };

  const updateDraftStations = (
    scope: 'production' | 'packaging',
    updater: (stations: WorkflowStation[]) => WorkflowStation[],
  ) => {
    setWorkflowDraft((prev) => {
      if (scope === 'production') {
        return {
          ...prev,
          productionStations: updater(prev.productionStations),
        };
      }
      return {
        ...prev,
        packagingStations: updater(prev.packagingStations),
      };
    });
  };

  const updateDraftStation = (
    scope: 'production' | 'packaging',
    stationId: string,
    updater: (station: WorkflowStation) => WorkflowStation,
  ) => {
    updateDraftStations(scope, (stations) =>
      stations.map((station) => (station.id === stationId ? updater(station) : station)),
    );
  };

  const addDraftStation = (
    scope: 'production' | 'packaging',
    productionModule: ProductionSection = 'griddle',
  ) => {
    const stationId = `${scope}-${createId()}`;
    settingsPendingStationFocusRef.current = { scope, stationId };
    setSettingsStationHighlight({
      scope,
      stationId,
      phase: 'show',
    });
    updateDraftStations(scope, (stations) => {
      const nextIndex = scope === 'production'
        ? stations.filter((station) => resolveProductionModuleFromStation(station) === productionModule).length + 1
        : stations.length + 1;
      return [
        ...stations,
        createWorkflowStationDraft(scope, nextIndex, productionModule, stationId),
      ];
    });
  };

  const removeDraftStation = (scope: 'production' | 'packaging', stationId: string) => {
    updateDraftStations(scope, (stations) => {
      if (stations.length <= 1) return stations;
      const next = stations.filter((station) => station.id !== stationId);
      return next.length > 0 ? next : stations;
    });
  };

  const moveDraftStation = (
    scope: 'production' | 'packaging',
    stationId: string,
    direction: -1 | 1,
  ) => {
    updateDraftStations(scope, (stations) => {
      const index = stations.findIndex((station) => station.id === stationId);
      if (index === -1) return stations;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= stations.length) return stations;
      const next = [...stations];
      const [picked] = next.splice(index, 1);
      next.splice(nextIndex, 0, picked);
      return next;
    });
  };

  const setDraftStationCategoryRule = (
    scope: 'production' | 'packaging',
    stationId: string,
    category: MenuCategory,
    mode: RoutingMatchMode,
  ) => {
    updateDraftStation(scope, stationId, (station) => ({
      ...station,
      categoryRules: {
        ...station.categoryRules,
        [category]: mode,
      },
    }));
  };

  const setDraftProductionStationModule = (
    stationId: string,
    module: ProductionSection,
  ) => {
    updateDraftStation('production', stationId, (station) => ({
      ...station,
      module,
      categoryRules: getCategoryRulesByProductionModule(module),
    }));
  };

  const addDraftStationTagRule = (
    scope: 'production' | 'packaging',
    stationId: string,
    preferredTag?: string,
  ) => {
    const fallbackTag = normalizeWorkflowTag(preferredTag ?? workflowDraft.menuTags[0] ?? '');
    if (!fallbackTag) return;
    updateDraftStation(scope, stationId, (station) => ({
      ...station,
      tagRules: [
        ...station.tagRules,
        {
          id: `station-tag-${createId()}`,
          tag: fallbackTag,
          mode: 'yes',
        },
      ],
    }));
  };

  const updateDraftStationTagRule = (
    scope: 'production' | 'packaging',
    stationId: string,
    ruleId: string,
    updater: (rule: WorkflowStationTagRule) => WorkflowStationTagRule,
  ) => {
    updateDraftStation(scope, stationId, (station) => ({
      ...station,
      tagRules: station.tagRules.map((rule) => (rule.id === ruleId ? updater(rule) : rule)),
    }));
  };

  const removeDraftStationTagRule = (
    scope: 'production' | 'packaging',
    stationId: string,
    ruleId: string,
  ) => {
    updateDraftStation(scope, stationId, (station) => ({
      ...station,
      tagRules: station.tagRules.filter((rule) => rule.id !== ruleId),
    }));
  };

  const updateDraftMenuItem = (
    itemId: string,
    updater: (item: WorkflowMenuItem) => WorkflowMenuItem,
  ) => {
    setWorkflowDraft((prev) => ({
      ...prev,
      menuItems: prev.menuItems.map((item) => (item.id === itemId ? updater(item) : item)),
    }));
  };

  const updateDraftMenuItemCategory = (itemId: string, category: MenuCategory) => {
    const categoryTagSet = new Set(Object.values(CATEGORY_TAG_BY_MENU_CATEGORY));
    updateDraftMenuItem(itemId, (item) => {
      const customTags = item.tags.filter((tag) => !categoryTagSet.has(tag));
      const defaultPrep = getDefaultPrepConfigForMenuItem({ id: item.id, category });
      const prepStation = sanitizePrepStation(item.prepStation, category, defaultPrep.prepStation);
      const prepSeconds = sanitizePrepSeconds(item.prepSeconds, defaultPrep.prepSeconds, prepStation);
      return {
        ...item,
        category,
        tags: [CATEGORY_TAG_BY_MENU_CATEGORY[category], ...customTags],
        prepStation,
        prepSeconds,
      };
    });
  };

  const updateDraftMenuItemPrepStation = (itemId: string, prepStation: PrepStation) => {
    updateDraftMenuItem(itemId, (item) => {
      const defaultPrep = getDefaultPrepConfigForMenuItem({ id: item.id, category: item.category });
      const nextPrepStation = sanitizePrepStation(prepStation, item.category, defaultPrep.prepStation);
      const nextPrepSeconds = sanitizePrepSeconds(
        item.prepSeconds,
        defaultPrep.prepSeconds,
        nextPrepStation,
      );
      return {
        ...item,
        prepStation: nextPrepStation,
        prepSeconds: nextPrepSeconds,
      };
    });
  };

  const updateDraftMenuItemPrepSeconds = (itemId: string, value: string) => {
    updateDraftMenuItem(itemId, (item) => {
      const defaultPrep = getDefaultPrepConfigForMenuItem({ id: item.id, category: item.category });
      const prepSeconds = sanitizePrepSeconds(value, defaultPrep.prepSeconds, item.prepStation);
      return {
        ...item,
        prepSeconds,
      };
    });
  };

  const updateDraftMenuItemOptionType = (itemId: string, optionType: MenuOptionType) => {
    updateDraftMenuItem(itemId, (item) => ({
      ...item,
      optionType,
      ...(optionType === 'soup_dumpling_flavor'
        ? {
          fixedDumplingCount: item.fixedDumplingCount ?? 8,
          baseDumplingPrice: item.baseDumplingPrice ?? 7,
        }
        : {}),
    }));
  };

  const addDraftMenuTag = (rawTag: string) => {
    const tag = normalizeWorkflowTag(rawTag);
    if (!tag) return;
    setWorkflowDraft((prev) => {
      if (prev.menuTags.includes(tag)) return prev;
      return {
        ...prev,
        menuTags: [...prev.menuTags, tag],
      };
    });
  };

  const removeDraftMenuTag = (tag: string) => {
    const categoryTags = new Set(Object.values(CATEGORY_TAG_BY_MENU_CATEGORY));
    if (categoryTags.has(tag)) return;
    setWorkflowDraft((prev) => ({
      ...prev,
      menuTags: prev.menuTags.filter((entry) => entry !== tag),
      menuItems: prev.menuItems.map((item) => {
        const nextTags = item.tags.filter((entry) => entry !== tag);
        return {
          ...item,
          tags: nextTags.length > 0 ? nextTags : [CATEGORY_TAG_BY_MENU_CATEGORY[item.category]],
        };
      }),
      productionStations: prev.productionStations.map((station) => ({
        ...station,
        tagRules: station.tagRules.filter((rule) => rule.tag !== tag),
      })),
      packagingStations: prev.packagingStations.map((station) => ({
        ...station,
        tagRules: station.tagRules.filter((rule) => rule.tag !== tag),
      })),
    }));
  };

  const addDraftTagToMenuItem = (itemId: string, rawTag: string) => {
    const tag = normalizeWorkflowTag(rawTag);
    if (!tag) return;
    setWorkflowDraft((prev) => ({
      ...prev,
      menuTags: prev.menuTags.includes(tag) ? prev.menuTags : [...prev.menuTags, tag],
      menuItems: prev.menuItems.map((item) => {
        if (item.id !== itemId) return item;
        if (item.tags.includes(tag)) return item;
        return {
          ...item,
          tags: [...item.tags, tag],
        };
      }),
    }));
  };

  const removeDraftTagFromMenuItem = (itemId: string, tag: string) => {
    setWorkflowDraft((prev) => ({
      ...prev,
      menuItems: prev.menuItems.map((item) => {
        if (item.id !== itemId) return item;
        const nextTags = item.tags.filter((entry) => entry !== tag);
        if (nextTags.length > 0) {
          return {
            ...item,
            tags: nextTags,
          };
        }
        return {
          ...item,
          tags: [CATEGORY_TAG_BY_MENU_CATEGORY[item.category]],
        };
      }),
    }));
  };

  const addDraftDependencyToMenuItem = (itemId: string, dependencyItemId: string) => {
    const dependencyId = dependencyItemId.trim();
    if (!dependencyId || dependencyId === itemId) return;
    setWorkflowDraft((prev) => {
      const dependencyTargetExists = prev.menuItems.some((item) => item.id === dependencyId);
      if (!dependencyTargetExists) return prev;
      return {
        ...prev,
        menuItems: prev.menuItems.map((item) => {
          if (item.id !== itemId) return item;
          if (item.dependencyItemIds.includes(dependencyId)) return item;
          return {
            ...item,
            dependencyMode: 'all',
            dependencyItemIds: [...item.dependencyItemIds, dependencyId],
          };
        }),
      };
    });
  };

  const removeDraftDependencyFromMenuItem = (itemId: string, dependencyItemId: string) => {
    setWorkflowDraft((prev) => ({
      ...prev,
      menuItems: prev.menuItems.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          dependencyItemIds: item.dependencyItemIds.filter((dependencyId) => dependencyId !== dependencyItemId),
        };
      }),
    }));
  };

  const removeDraftMenuItem = (itemId: string) => {
    setWorkflowDraft((prev) => {
      const target = prev.menuItems.find((item) => item.id === itemId);
      if (!target || !target.custom) return prev;
      const nextItems = prev.menuItems.filter((item) => item.id !== itemId);
      const nextItemIdSet = new Set(nextItems.map((item) => item.id));
      return {
        ...prev,
        menuItems: nextItems.length > 0
          ? nextItems.map((item) => ({
            ...item,
            dependencyItemIds: item.dependencyItemIds.filter((dependencyId) => nextItemIdSet.has(dependencyId)),
          }))
          : prev.menuItems,
      };
    });
  };

  const addDraftMenuItemFromSettings = () => {
    const name = settingsNewMenuItem.name.trim();
    const price = Number(settingsNewMenuItem.price);
    if (!name || !Number.isFinite(price) || price < 0) return;
    const normalizedTags = sanitizeTagArray(
      settingsNewMenuItem.tags
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    const tags = normalizedTags.length > 0
      ? normalizedTags
      : [CATEGORY_TAG_BY_MENU_CATEGORY[settingsNewMenuItem.category]];
    const nextItemId = `custom-${createId()}`;
    const defaultPrep = getDefaultPrepConfigForMenuItem({
      id: nextItemId,
      category: settingsNewMenuItem.category,
    });
    const prepStation = sanitizePrepStation(
      settingsNewMenuItem.prepStation,
      settingsNewMenuItem.category,
      defaultPrep.prepStation,
    );
    const prepSeconds = sanitizePrepSeconds(
      settingsNewMenuItem.prepSeconds,
      defaultPrep.prepSeconds,
      prepStation,
    );
    const nextItem: WorkflowMenuItem = {
      id: nextItemId,
      category: settingsNewMenuItem.category,
      name: name.slice(0, 40),
      price: Math.round(price * 10) / 10,
      unit: settingsNewMenuItem.unit,
      optionType: settingsNewMenuItem.optionType,
      soldOut: false,
      custom: true,
      tags,
      dependencyMode: 'all',
      dependencyItemIds: [],
      prepStation,
      prepSeconds,
      ...(settingsNewMenuItem.optionType === 'soup_dumpling_flavor'
        ? { fixedDumplingCount: 8, baseDumplingPrice: 7 }
        : {}),
    };
    setWorkflowDraft((prev) => ({
      ...prev,
      menuItems: [...prev.menuItems, nextItem],
      menuTags: sanitizeTagArray([...prev.menuTags, ...tags]),
    }));
    const resetPrepStation = sanitizePrepStation(
      settingsNewMenuItem.prepStation,
      settingsNewMenuItem.category,
      defaultPrep.prepStation,
    );
    const resetPrepSeconds = String(
      sanitizePrepSeconds(
        settingsNewMenuItem.prepSeconds,
        defaultPrep.prepSeconds,
        resetPrepStation,
      ),
    );
    setSettingsNewMenuItem({
      name: '',
      category: settingsNewMenuItem.category,
      price: '',
      unit: settingsNewMenuItem.unit,
      optionType: settingsNewMenuItem.optionType,
      tags: '',
      prepStation: resetPrepStation,
      prepSeconds: resetPrepStation === 'none' ? '0' : resetPrepSeconds,
    });
  };

  const rebootWorkflowRuntime = (nextSettings: WorkflowSettings = workflowSettings) => {
    clearAllOrders();
    setSettingsPanel('stations');
    setSettingsMenuActiveTag('all');
    setSettingsMenuExpandedItemId(null);
    setSettingsTagLibraryExpanded(false);
    setSettingsNewItemExpanded(false);
    setSettingsNewTagInput('');
    setSettingsStationHighlight(null);
    setSettingsExpandedStationKeys([]);
    settingsPendingStationFocusRef.current = null;
    setSettingsLeaveNotice(null);
    setSettingsNewMenuItem({
      name: '',
      category: 'side',
      price: '',
      unit: '份',
      optionType: 'none',
      tags: '',
      prepStation: 'none',
      prepSeconds: '0',
    });
    setServiceMode(null);
    setCustomerPage('landing');
    clearTutorialStepTimer();
    setCustomerTutorialActive(false);
    setCustomerTutorialStep('box_add');
    setTutorialSpotlightRect(null);
    setActiveCategory('potsticker');
    setActivePerspective(userPerspectivePolicy.defaultPerspective);
    setProductionSection('griddle');
    setActivePackagingLane(getInitialPackagingLaneId(nextSettings));
    setPackagingSearchKeyword('');
    setPackagingTopQueueSize('lg');
    setPackagingTopQueueLimit(3);
    setPackagingTopQueueLimitInput('3');
    setExpandedWorkflowOrderId(null);

    setProductionOrders([]);
    setPackagingOrders([]);
    setPackagingStatusByOrderId({});
    setPackagingItemStatusOverrides({});
    setPackagingPinnedOrderIds([]);
    setPackagingDraggingOrderId(null);
    setPackagingDropActive(false);
    setPackagingQueuedTapArmedKey(null);
    setArchivedOrderIds([]);
    setArchivingOrderIds([]);
    setWorkflowOrderNotes({});

    Object.values(archiveOrderTimerRef.current).forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    archiveOrderTimerRef.current = {};

    setFryStations(createInitialFryStations());
    setShowFryOrderDetails({
      griddle_a: false,
      griddle_b: false,
    });
    setActiveFryPreviewPanel(null);
    setSplitOrderIds([]);
    setFriedEntryIds([]);
    setFriedPotstickerPieces(0);

    setWaterLadleCountByStationId({});
    setWaterTaskProgress({});
    setWaterUnlockedTaskIds([]);
    setSelectedWaterTransferTaskId(null);
    setWaterTransferFx(null);
    setWaterForceFinishPromptTaskId(null);
    setWaterDumplingCapturedTaskIds([]);
    setShowWaterCompletedPanelBySection({
      dumpling: false,
      noodle: false,
    });

    clearPackagingQueuedTapArmed();
    clearIncrementPressTimers();

    setOrderSequence(1);
    setSubmitNotice(null);
    setSeedOrdersNotice(null);
  };

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const state = await backofficeApi.getWorkflowResetState();
        if (cancelled) return;
        const current = workflowResetVersionRef.current;
        if (current === null) {
          workflowResetVersionRef.current = state.version;
          return;
        }
        if (state.version > current) {
          workflowResetVersionRef.current = state.version;
          rebootWorkflowRuntime(workflowSettings);
          return;
        }
        workflowResetVersionRef.current = state.version;
      } catch {
        // best effort
      }
    };
    void sync();
    const timer = window.setInterval(() => {
      void sync();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workflowSettings]);

  const saveWorkflowSettings = () => {
    const normalized = sanitizeWorkflowSettings(workflowDraft);
    const stationsChanged = (
      JSON.stringify(normalized.productionStations) !== JSON.stringify(workflowSettings.productionStations)
      || JSON.stringify(normalized.packagingStations) !== JSON.stringify(workflowSettings.packagingStations)
    );
    if (stationsChanged && typeof window !== 'undefined') {
      const confirmed = window.confirm('變更工作站設定將重啟系統，確定要儲存嗎？');
      if (!confirmed) return;
    }
    setWorkflowSettings(normalized);
    setWorkflowDraft(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(workflowSettingsStorageKey, JSON.stringify(normalized));
    }
    if (stationsChanged) {
      rebootWorkflowRuntime(normalized);
    }
    setSettingsSaveNotice({
      stamp: Date.now(),
      phase: 'show',
      rebooted: stationsChanged,
    });
  };

  const updateStationLanguage = (stationId: string, lang: StationLanguage) => {
    const updateStations = (stations: WorkflowStation[]) =>
      stations.map((s) => (s.id === stationId ? { ...s, language: lang } : s));
    const nextSettings: WorkflowSettings = {
      ...workflowSettings,
      productionStations: updateStations(workflowSettings.productionStations),
    };
    setWorkflowSettings(nextSettings);
    setWorkflowDraft((prev) => ({
      ...prev,
      productionStations: updateStations(prev.productionStations),
    }));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(workflowSettingsStorageKey, JSON.stringify(nextSettings));
    }
  };

  const resetWorkflowDraft = () => {
    setWorkflowDraft(workflowSettings);
    setSettingsMenuActiveTag('all');
    setSettingsMenuExpandedItemId(null);
    setSettingsTagLibraryExpanded(false);
    setSettingsNewItemExpanded(false);
    setSettingsNewTagInput('');
    setSettingsStationHighlight(null);
    setSettingsExpandedStationKeys([]);
    settingsPendingStationFocusRef.current = null;
    setSettingsLeaveNotice(null);
  };

  const finishCustomerTutorial = (markCompleted = true) => {
    clearTutorialStepTimer();
    clearAllOrders();
    setCustomerPage('ordering');
    setActiveCategory('potsticker');
    setCustomerTutorialActive(false);
    setCustomerTutorialStep('box_add');
    setTutorialSpotlightRect(null);
    if (markCompleted) {
      setCustomerTutorialPreference((prev) => ({
        ...prev,
        completed: true,
      }));
    }
  };

  const handleTutorialToggle = () => {
    const nextEnabled = !customerTutorialEnabled;
    setCustomerTutorialPreference((prev) => ({
      ...prev,
      enabled: nextEnabled,
    }));
    if (!nextEnabled && customerTutorialActive) {
      finishCustomerTutorial(true);
    }
  };

  const startCustomerTutorial = () => {
    clearTutorialStepTimer();
    setCustomerTutorialPreference((prev) => ({
      ...prev,
      enabled: true,
      completed: false,
    }));
    clearAllOrders();
    if (!activatePerspective('customer')) return;
    setServiceMode((prev) => prev ?? 'dine_in');
    setCustomerPage('ordering');
    setActiveCategory('potsticker');
    setCustomerTutorialActive(true);
    setCustomerTutorialStep('box_add');
    setTutorialSpotlightRect(null);
  };

  const skipCustomerTutorial = () => {
    finishCustomerTutorial(true);
  };

  const goToNextTutorialStep = () => {
    if (!customerTutorialActive) return;
    if (customerTutorialStep === 'box_add' && !tutorialStepReady) return;
    if (!tutorialNextStep) {
      finishCustomerTutorial(true);
      return;
    }

    if (customerTutorialStep === 'box_add' && tutorialNextStep === 'box_switch') {
      setBoxState((prev) => {
        const currentBoxes = prev.potsticker;
        if (currentBoxes.length >= 3) return prev;
        const addCount = 3 - currentBoxes.length;
        const extraBoxes = Array.from({ length: addCount }, () =>
          createBoxSelection('box-20', 'potsticker'),
        );
        return {
          ...prev,
          potsticker: [...currentBoxes, ...extraBoxes],
        };
      });
    }

    if (tutorialNextStep === 'switch_category') {
      setExpandedConfigItemId(null);
    }

    setCustomerTutorialStep(tutorialNextStep);
  };

  const jumpToTutorialTarget = () => {
    activatePerspective('customer');
    setCustomerPage('ordering');
    switch (customerTutorialStep) {
      case 'box_add':
      case 'box_switch':
      case 'box_fill':
        setActiveCategory('potsticker');
        break;
      case 'switch_category':
      case 'add_item_open':
        setActiveCategory(tutorialSwitchCategory);
        break;
      default:
        break;
    }
    window.setTimeout(() => {
      const node = tutorialTargetKey ? tutorialTargetRefs.current[tutorialTargetKey] : null;
      node?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 120);
  };

  const handleServiceModeSelect = (nextMode: ServiceMode) => {
    setServiceMode(nextMode);
    setCustomerPage('ordering');
  };

  const handleCustomerCategorySelect = (category: MenuCategory) => {
    setActiveCategory(category);
  };

  const scrollToCart = () => {
    activatePerspective('customer');
    setCustomerPage('cart');
    window.setTimeout(() => {
      cartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const submitOrder = () => {
    if (!serviceMode || !hasAnySelection) return;

    const nextOrderId = formatOrderId(orderSequence);
    const normalizedOrderNote = cartOrderNote.trim().slice(0, 120);
    const snapshot: SubmittedOrder = {
      id: nextOrderId,
      createdAt: Date.now(),
      serviceMode,
      totalAmount,
      totalCount,
      ...(normalizedOrderNote ? { orderNote: normalizedOrderNote } : {}),
      cartLines: cart.map((line) => ({ ...line })),
      boxRows: boxSummary.map((row) => ({
        ...row,
        items: row.items.map((item) => ({ ...item })),
      })),
    };

    setProductionOrders((prev) => [snapshot, ...prev]);
    setPackagingOrders((prev) => [snapshot, ...prev]);
    persistWorkflowOrder(snapshot, 'waiting_pickup', 'customer');
    setOrderSequence((prev) => prev + 1);
    setSubmitNotice({ orderId: nextOrderId, stamp: Date.now(), phase: 'show' });
    clearAllOrders();
    activatePerspective('customer');
    setCustomerPage('cart');
  };

  const ingestItemModsToLabels = (mods: unknown): string[] => {
    if (!Array.isArray(mods)) return [];
    const output: string[] = [];
    const seen = new Set<string>();
    mods.forEach((entry) => {
      if (typeof entry === 'string') {
        const token = entry.trim();
        if (!token || seen.has(token)) return;
        seen.add(token);
        output.push(token);
        return;
      }
      if (!isRecord(entry)) return;
      const modRaw = typeof entry.mod_raw === 'string' ? entry.mod_raw.trim() : '';
      const modName = typeof entry.mod_name === 'string' ? entry.mod_name.trim() : '';
      const type = typeof entry.type === 'string' ? entry.type.trim() : '';
      const value = typeof entry.value === 'string' ? entry.value.trim() : '';
      const label = modRaw || modName
        || (type ? (value ? `${type}:${value}` : type) : value);
      if (!label || seen.has(label)) return;
      seen.add(label);
      output.push(label);
    });
    return output;
  };

  const parseIngestQty = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    const qty = Math.max(1, Math.round(parsed));
    return qty;
  };

  const parseIngestLineIndex = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
  };

  const parseIngestOrderPayload = (orderPayloadRaw: unknown) => {
    if (!isRecord(orderPayloadRaw)) return null;
    const orderPayload = orderPayloadRaw;
    const order = isRecord(orderPayload.order) ? orderPayload.order : null;
    if (!order) return null;
    return {
      orderPayload,
      order,
      items: Array.isArray(order.items) ? order.items : [],
      groups: Array.isArray(order.groups) ? order.groups : [],
    };
  };

  const mapIngestItemToMenu = (itemPayload: Record<string, unknown>) => {
    const itemCode = typeof itemPayload.item_code === 'string' ? itemPayload.item_code.trim() : '';
    if (itemCode && itemMap.has(itemCode)) {
      return {
        menuItem: itemMap.get(itemCode) ?? null,
        score: 1,
        matchedBy: 'item_code',
      };
    }

    const candidateNames = [
      typeof itemPayload.name_normalized === 'string' ? itemPayload.name_normalized : '',
      typeof itemPayload.name_raw === 'string' ? itemPayload.name_raw : '',
      typeof itemPayload.raw_line === 'string' ? itemPayload.raw_line : '',
      itemCode,
    ]
      .map((entry) => entry.trim())
      .filter(Boolean);

    let bestItem: WorkflowMenuItem | null = null;
    let bestScore = 0;
    candidateNames.forEach((candidate) => {
      menuItems.forEach((menuItem) => {
        const score = scoreIngestNameCandidate(candidate, menuItem.name);
        if (score > bestScore) {
          bestScore = score;
          bestItem = menuItem;
        }
      });
    });

    if (!bestItem || bestScore < 0.6) {
      return {
        menuItem: null,
        score: bestScore,
        matchedBy: 'unmatched',
      };
    }
    return {
      menuItem: bestItem,
      score: bestScore,
      matchedBy: 'name_similarity',
    };
  };

  const buildOrderFromIngestPayload = (
    orderPayloadRaw: unknown,
    fallbackOrderId = '',
  ) => {
    const parsed = parseIngestOrderPayload(orderPayloadRaw);
    if (!parsed) {
      return {
        ok: false as const,
        message: '進單結果缺少 order_payload.order',
      };
    }

    const sourceOrderId = (
      typeof parsed.order.order_id === 'string' && parsed.order.order_id.trim()
        ? parsed.order.order_id.trim()
        : fallbackOrderId.trim()
    ) || '';
    const groupsByLine = new Map<number, string[]>();
    parsed.groups.forEach((group) => {
      if (!isRecord(group)) return;
      const label = typeof group.label === 'string' && group.label.trim()
        ? group.label.trim()
        : (
          typeof group.group_id === 'string' && group.group_id.trim()
            ? group.group_id.trim()
            : ''
        );
      if (!label) return;
      const lineIndicesRaw = Array.isArray(group.line_indices) ? group.line_indices : [];
      lineIndicesRaw.forEach((lineIndexRaw) => {
        const lineIndex = parseIngestLineIndex(lineIndexRaw, -1);
        if (lineIndex < 0) return;
        const current = groupsByLine.get(lineIndex) ?? [];
        if (current.includes(label)) {
          groupsByLine.set(lineIndex, current);
          return;
        }
        groupsByLine.set(lineIndex, [...current, label]);
      });
    });

    const aggregated = new Map<string, CartLine>();
    const unmatchedLines: string[] = [];
    let reviewLineCount = 0;

    parsed.items.forEach((itemRaw, fallbackIndex) => {
      if (!isRecord(itemRaw)) return;
      const lineIndex = parseIngestLineIndex(itemRaw.line_index, fallbackIndex);
      const qty = parseIngestQty(itemRaw.qty);
      const nameRaw = typeof itemRaw.name_raw === 'string' ? itemRaw.name_raw.trim() : '';
      const noteRaw = typeof itemRaw.note_raw === 'string' ? itemRaw.note_raw.trim() : '';
      const modLabels = ingestItemModsToLabels(itemRaw.mods);
      const groupLabels = groupsByLine.get(lineIndex) ?? [];
      const segments = [noteRaw, ...modLabels, ...groupLabels.map((label) => `群組:${label}`)]
        .map((entry) => entry.trim())
        .filter(Boolean);
      const lineNote = segments.join('；').slice(0, 120);

      if (itemRaw.needs_review === true) reviewLineCount += 1;

      const mapped = mapIngestItemToMenu(itemRaw);
      if (!mapped.menuItem) {
        const unresolvedName = nameRaw || `line#${lineIndex}`;
        unmatchedLines.push(unresolvedName);
        return;
      }

      const mergeKey = `${mapped.menuItem.id}|${lineNote || '-'}|${mapped.menuItem.optionType}`;
      const existing = aggregated.get(mergeKey);
      if (existing) {
        aggregated.set(mergeKey, {
          ...existing,
          quantity: existing.quantity + qty,
        });
        return;
      }

      aggregated.set(mergeKey, {
        id: createId(),
        mergeKey,
        menuItemId: mapped.menuItem.id,
        name: mapped.menuItem.name,
        unitLabel: mapped.menuItem.unit,
        unitPrice: mapped.menuItem.price,
        quantity: qty,
        ...(lineNote ? { note: lineNote } : {}),
      });
    });

    const cartLines = Array.from(aggregated.values());
    if (cartLines.length === 0) {
      return {
        ok: false as const,
        message: unmatchedLines.length > 0
          ? `全部品項都未對齊本店菜單：${unmatchedLines.join('、')}`
          : '解析結果沒有可導入的品項',
      };
    }

    const totalAmount = cartLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const totalCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
    const metadata = isRecord(parsed.order.metadata) ? parsed.order.metadata : {};
    const serviceModeRaw = typeof metadata.service_mode === 'string' ? metadata.service_mode.trim() : '';
    const nextServiceMode: ServiceMode = serviceModeRaw === 'dine_in' ? 'dine_in' : 'takeout';

    // Build lineIndex → CartLine mapping for boxRows
    const lineIndexToCartLine = new Map<number, CartLine>();
    parsed.items.forEach((itemRaw, fallbackIndex) => {
      if (!isRecord(itemRaw)) return;
      const lineIndex = parseIngestLineIndex(itemRaw.line_index, fallbackIndex);
      const mapped = mapIngestItemToMenu(itemRaw);
      if (!mapped.menuItem) return;
      const noteRaw = typeof itemRaw.note_raw === 'string' ? itemRaw.note_raw.trim() : '';
      const modLabels = ingestItemModsToLabels(itemRaw.mods);
      const groupLabelsForLine = groupsByLine.get(lineIndex) ?? [];
      const segments = [noteRaw, ...modLabels, ...groupLabelsForLine.map((l) => `群組:${l}`)]
        .map((e) => e.trim()).filter(Boolean);
      const lineNote = segments.join('；').slice(0, 120);
      const mergeKey = `${mapped.menuItem.id}|${lineNote || '-'}|${mapped.menuItem.optionType}`;
      const existing = aggregated.get(mergeKey);
      if (existing) {
        lineIndexToCartLine.set(lineIndex, existing);
      }
    });

    // Build boxRows from groups
    const boxRows: SubmittedOrder['boxRows'] = [];
    parsed.groups.forEach((group) => {
      if (!isRecord(group)) return;
      const groupType = typeof group.type === 'string' ? group.type.trim() : '';
      const groupLabel = typeof group.label === 'string' && group.label.trim()
        ? group.label.trim()
        : (typeof group.group_id === 'string' ? group.group_id.trim() : 'group');
      const lineIndicesRaw = Array.isArray(group.line_indices) ? group.line_indices : [];
      const memberLines: CartLine[] = [];
      lineIndicesRaw.forEach((li) => {
        const idx = parseIngestLineIndex(li, -1);
        if (idx < 0) return;
        const cartLine = lineIndexToCartLine.get(idx);
        if (cartLine && !memberLines.includes(cartLine)) memberLines.push(cartLine);
      });
      if (memberLines.length === 0) return;

      if (groupType === 'separate') {
        // Each item gets its own box
        memberLines.forEach((cl) => {
          boxRows.push({
            id: `ingest-${createId()}`,
            boxLabel: `${groupLabel} · ${cl.name}`,
            typeLabel: groupLabel,
            items: [{ name: cl.name, count: cl.quantity, unitPrice: cl.unitPrice, subtotal: cl.unitPrice * cl.quantity }],
            subtotal: cl.unitPrice * cl.quantity,
          });
        });
      } else {
        // pack_together / other → one box for all
        const items = memberLines.map((cl) => ({
          name: cl.name,
          count: cl.quantity,
          unitPrice: cl.unitPrice,
          subtotal: cl.unitPrice * cl.quantity,
        }));
        const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
        boxRows.push({
          id: `ingest-${createId()}`,
          boxLabel: `${groupLabel} · ${items.length}品`,
          typeLabel: groupLabel,
          items,
          subtotal,
        });
      }
    });

    const takenOrderIds = new Set<string>([
      ...productionOrders.map((order) => order.id),
      ...packagingOrders.map((order) => order.id),
    ]);
    const baseOrderId = sourceOrderId || formatOrderId(orderSequence);
    let nextOrderId = baseOrderId;
    let dedupIndex = 2;
    while (takenOrderIds.has(nextOrderId)) {
      nextOrderId = `${baseOrderId}-${dedupIndex}`;
      dedupIndex += 1;
    }

    const noteSegments = [
      sourceOrderId ? `ingest:${sourceOrderId}` : 'ingest',
      reviewLineCount > 0 ? `needs_review:${reviewLineCount}` : '',
      unmatchedLines.length > 0 ? `unmatched:${unmatchedLines.length}` : '',
      typeof metadata.fallback_reason === 'string' && metadata.fallback_reason.trim()
        ? `fallback:${metadata.fallback_reason.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 120);

    const snapshot: SubmittedOrder = {
      id: nextOrderId,
      createdAt: Date.now(),
      serviceMode: nextServiceMode,
      totalAmount,
      totalCount,
      ...(noteSegments ? { orderNote: noteSegments } : {}),
      cartLines,
      boxRows,
    };

    return {
      ok: true as const,
      snapshot,
      unmatchedLines,
      reviewLineCount,
      matchedLineCount: cartLines.length,
      sourceOrderId,
    };
  };

  const commitBuiltIngestOrder = (snapshot: SubmittedOrder, sourceOrderId?: string) => {
    setProductionOrders((prev) => [snapshot, ...prev]);
    setPackagingOrders((prev) => [snapshot, ...prev]);
    persistWorkflowOrder(snapshot, 'waiting_pickup', 'ingest');
    const createdAt = Date.now();
    const safeSourceOrderId = sourceOrderId?.trim() || snapshot.id;
    setIngestDispatchNotices((prev) => ([
      {
        id: `${createdAt}-${snapshot.id}`,
        sourceOrderId: safeSourceOrderId,
        systemOrderId: snapshot.id,
        createdAt,
      },
      ...prev,
    ].slice(0, 50)));
    setOrderSequence((prev) => prev + 1);
    setSubmitNotice({ orderId: snapshot.id, stamp: Date.now(), phase: 'show' });
  };

  const handleDispatchReviewOrder = async (
    orderPayloadRaw: unknown,
  ): Promise<{ ok: boolean; message: string; systemOrderId?: string }> => {
    const built = buildOrderFromIngestPayload(orderPayloadRaw);
    if (!built.ok) {
      return {
        ok: false,
        message: built.message,
      };
    }

    if (built.unmatchedLines.length > 0) {
      return {
        ok: false,
        message: `有 ${built.unmatchedLines.length} 行無法對齊菜單，請先人工確認：${built.unmatchedLines.join('、')}`,
      };
    }

    commitBuiltIngestOrder(built.snapshot, built.sourceOrderId);

    return {
      ok: true,
      message: `已導入訂單 ${built.snapshot.id}（${built.snapshot.totalCount} 件）到製作/包裝`,
      systemOrderId: built.snapshot.id,
    };
  };

  const handleEditReviewOrder = async (
    orderPayloadRaw: unknown,
  ): Promise<{ ok: boolean; message: string }> => {
    const built = buildOrderFromIngestPayload(orderPayloadRaw);
    if (!built.ok) {
      return {
        ok: false,
        message: built.message,
      };
    }

    const initial = createInitialBoxState();
    setServiceMode(built.snapshot.serviceMode);
    setCart(built.snapshot.cartLines.map((line) => ({ ...line })));
    setCartOrderNote(
      built.sourceOrderId
        ? `來源單號 ${built.sourceOrderId}`
        : '',
    );
    setBoxState(initial.boxes);
    setActiveBoxState(initial.active);
    setExpandedConfigItemId(null);
    setConfigQuantity(1);
    setConfigNote('');
    setActiveCategory('potsticker');
    activatePerspective('customer');
    setCustomerPage('cart');

    return {
      ok: true,
      message: `已載入點餐端修單：${built.snapshot.totalCount} 件`,
    };
  };

  const resolveIngestItemForPending = (itemPayload: Record<string, unknown>) => {
    const mapped = mapIngestItemToMenu(itemPayload);
    if (!mapped.menuItem) {
      return {
        mappedName: typeof itemPayload.name_normalized === 'string' && itemPayload.name_normalized.trim()
          ? itemPayload.name_normalized.trim()
          : (
            typeof itemPayload.name_raw === 'string'
              ? itemPayload.name_raw.trim()
              : null
          ),
        menuItemId: null,
        soldOut: false,
        soldOutReason: null,
      };
    }

    const availability = getMenuAvailability(mapped.menuItem.id);
    if (!availability.unavailable) {
      return {
        mappedName: mapped.menuItem.name,
        menuItemId: mapped.menuItem.id,
        soldOut: false,
        soldOutReason: null,
      };
    }

    const blockingNames = availability.blockingDependencyIds
      .map((dependencyId) => itemMap.get(dependencyId)?.name ?? dependencyId)
      .filter((entry) => entry.trim().length > 0);
    const soldOutReason = availability.directSoldOut
      ? '手動售完'
      : (
        blockingNames.length > 0
          ? `相依售完：${blockingNames.join('、')}`
          : '不可供應'
      );

    return {
      mappedName: mapped.menuItem.name,
      menuItemId: mapped.menuItem.id,
      soldOut: true,
      soldOutReason,
    };
  };

  const isAutoDispatchReadyOrder = (detail: ReviewOrderDetail) => {
    const normalizedStatus = detail.status.trim().toLowerCase();
    return (
      (normalizedStatus === 'dispatch_ready' || normalizedStatus === 'dispatched' || normalizedStatus === 'approved')
      && !detail.overallNeedsReview
    );
  };

  const syncDispatchReadyOrdersToWorkflow = async () => {
    if (autoDispatchSyncingRef.current) return;
    autoDispatchSyncingRef.current = true;
    try {
      const details = await ordersApi.getReviewDetails({ pageSize: 300 });
      const candidates = details
        .filter((detail) => isAutoDispatchReadyOrder(detail))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

      for (const detail of candidates) {
        if (autoDispatchedReviewOrderIdsRef.current.has(detail.orderId)) continue;

        const built = buildOrderFromIngestPayload(detail.orderPayload, detail.orderId);
        if (!built.ok) continue;
        if (built.unmatchedLines.length > 0) continue;

        commitBuiltIngestOrder(built.snapshot, detail.orderId);
        autoDispatchedReviewOrderIdsRef.current.add(detail.orderId);

        try {
          await ordersApi.deleteReviewOrder(detail.orderId);
        } catch {
          // no-op: avoid duplicate import in this session even if backend deletion failed.
        }
      }
    } catch {
      // best-effort background sync
    } finally {
      autoDispatchSyncingRef.current = false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await syncDispatchReadyOrdersToWorkflow();
    };
    void run();

    const timer = window.setInterval(() => {
      void run();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser.storeId, orderSequence, productionOrders, packagingOrders]);

  const updateFryStationCapacity = (stationId: FryStationId, capacityInput: string) => {
    const parsed = Number(capacityInput);
    if (!Number.isFinite(parsed)) return;
    const nextCapacity = Math.max(1, Math.round(parsed));
    setFryStations((prev) => ({
      ...prev,
      [stationId]: {
        ...prev[stationId],
        capacity: nextCapacity,
      },
    }));
  };

  const updateFryStationDuration = (stationId: FryStationId, durationInput: string) => {
    const parsed = Number(durationInput);
    if (!Number.isFinite(parsed)) return;
    const nextDuration = Math.max(1, Math.round(parsed));
    setFryStations((prev) => ({
      ...prev,
      [stationId]: {
        ...prev[stationId],
        frySeconds: nextDuration,
      },
    }));
  };

  const lockFryStationBatch = (stationId: FryStationId) => {
    const station = fryStations[stationId];
    if (station.lockedBatch) return;
    const recommendation = fryRecommendations[stationId];
    if (!recommendation || recommendation.orders.length === 0) return;

    const snapshotOrders = recommendation.orders.map((entry) => ({
      ...entry,
      flavorCounts: entry.flavorCounts.map((flavor) => ({ ...flavor })),
    }));
    const stationFrySeconds = Math.max(1, Math.round(station.frySeconds) || FRY_BATCH_SECONDS);
    const batchDurationSeconds = Math.max(
      stationFrySeconds,
      ...snapshotOrders.map((entry) => Math.max(1, Math.round(entry.durationSeconds) || FRY_BATCH_SECONDS)),
    );

    setFryStations((prev) => ({
      ...prev,
      [stationId]: {
        ...prev[stationId],
        lockedBatch: {
          entryIds: snapshotOrders.map((entry) => entry.entryId),
          orderIds: Array.from(new Set(snapshotOrders.map((entry) => entry.orderId))),
          totalPotstickers: recommendation.totalPotstickers,
          orders: snapshotOrders,
          durationSeconds: batchDurationSeconds,
          lockedAt: Date.now(),
          timerStartedAt: null,
        },
      },
    }));
  };

  const startFryStationTimer = (stationId: FryStationId) => {
    setFryStations((prev) => {
      const lockedBatch = prev[stationId].lockedBatch;
      if (!lockedBatch || lockedBatch.timerStartedAt) return prev;
      return {
        ...prev,
        [stationId]: {
          ...prev[stationId],
          lockedBatch: {
            ...lockedBatch,
            timerStartedAt: Date.now(),
          },
        },
      };
    });
  };

  const completeFryStationBatch = (stationId: FryStationId) => {
    const lockedBatch = fryStations[stationId].lockedBatch;
    if (!lockedBatch?.timerStartedAt) return;
    const elapsedSeconds = Math.floor((Date.now() - lockedBatch.timerStartedAt) / 1000);
    if (elapsedSeconds < Math.max(1, lockedBatch.durationSeconds || FRY_BATCH_SECONDS)) return;

    setFriedEntryIds((prev) => Array.from(new Set([...prev, ...lockedBatch.entryIds])));
    setFriedPotstickerPieces((prev) => prev + lockedBatch.totalPotstickers);
    setFryStations((prev) => ({
      ...prev,
      [stationId]: {
        ...prev[stationId],
        lockedBatch: null,
      },
    }));
  };

  const toggleFryOrderDetails = (stationId: FryStationId) => {
    setShowFryOrderDetails((prev) => ({
      ...prev,
      [stationId]: !prev[stationId],
    }));
  };

  const splitOrderByBox = (orderId: string) => {
    setSplitOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
  };

  const captureWaterDumplingBatch = () => {
    setWaterDumplingCapturedTaskIds(
      waterEstimatedDumplingBatch.tasks.map((task) => task.taskId),
    );
  };

  const startCapturedWaterDumplingBatch = () => {
    if (waterDumplingCapturedTaskIds.length === 0) return;
    const now = Date.now();

    setWaterTaskProgress((prev) => {
      let changed = false;
      const next = { ...prev };

      waterDumplingCapturedTaskIds.forEach((taskId) => {
        const task = waterTaskMap.get(taskId);
        if (!task || task.type !== 'dumpling') return;
        const current = next[taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };
        if (current.status !== 'queued') return;
        next[taskId] = {
          status: 'cooking',
          startedAt: now,
          ladleSlot: null,
        };
        changed = true;
      });

      return changed ? next : prev;
    });

    setWaterDumplingCapturedTaskIds([]);
  };

  const updateWaterLadleCapacity = (capacityInput: string) => {
    if (!activeNoodleStationId) return;
    const parsed = Number(capacityInput);
    if (!Number.isFinite(parsed)) return;
    const nextCapacity = Math.max(Math.max(1, waterMaxOccupiedLadleSlot), Math.round(parsed));
    setWaterLadleCountByStationId((prev) => ({
      ...prev,
      [activeNoodleStationId]: nextCapacity,
    }));
  };

  const getWaterTaskStationId = (taskId: string) => waterTaskStationByTaskId.get(taskId) ?? null;

  const startWaterTask = (taskId: string) => {
    const targetTask = waterTaskMap.get(taskId);
    if (!targetTask) return;
    const taskStationId = getWaterTaskStationId(taskId);
    const taskLadleCapacity = getWaterLadleCapacityForStation(taskStationId);

    setWaterTaskProgress((prev) => {
      const current = prev[taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };
      if (current.status !== 'queued') return prev;

      let ladleSlot = current.ladleSlot;
      if (targetTask.requiresLadle && ladleSlot === null) return prev;
      if (targetTask.requiresLadle && ladleSlot !== null) {
        if (ladleSlot < 1 || ladleSlot > taskLadleCapacity) return prev;
        const occupiedByOther = waterTasks.some((task) => {
          if (!task.requiresLadle || task.taskId === taskId) return false;
          if (getWaterTaskStationId(task.taskId) !== taskStationId) return false;
          const progress = prev[task.taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };
          return progress.status === 'cooking' && progress.ladleSlot === ladleSlot;
        });
        if (occupiedByOther) return prev;
      }
      if (!targetTask.requiresLadle) {
        ladleSlot = null;
      }

      return {
        ...prev,
        [taskId]: {
          status: 'cooking',
          startedAt: Date.now(),
          ladleSlot,
        },
      };
    });
  };

  const isWaterTaskUnlocked = (taskId: string) => waterUnlockedTaskIdSet.has(taskId);

  const toggleWaterTaskUnlock = (taskId: string) => {
    const progress = getWaterTaskProgress(taskId);
    if (progress.status !== 'cooking') return;
    setWaterUnlockedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((entryId) => entryId !== taskId)
        : [...prev, taskId],
    );
  };

  const canSelectWaterTransferTask = (taskId: string) => {
    const task = waterTaskMap.get(taskId);
    if (!task || !task.requiresLadle) return false;
    const progress = getWaterTaskProgress(taskId);
    if (progress.status === 'queued') return true;
    if (progress.status === 'cooking') return isWaterTaskUnlocked(taskId);
    return false;
  };

  const canAssignWaterTaskToLadleSlot = (taskId: string, slot: number) => {
    const task = waterTaskMap.get(taskId);
    if (!task || !task.requiresLadle) return false;
    const taskStationId = getWaterTaskStationId(taskId);
    const taskLadleCapacity = getWaterLadleCapacityForStation(taskStationId);
    if (slot < 1 || slot > taskLadleCapacity) return false;
    const progress = getWaterTaskProgress(taskId);
    if (progress.status === 'done') return false;
    if (progress.status === 'cooking' && !isWaterTaskUnlocked(taskId)) return false;
    if (progress.status === 'cooking' && progress.ladleSlot === slot) return false;
    const occupiedTask = waterCookingTaskByLadleSlot.get(slot);
    if (
      occupiedTask &&
      occupiedTask.taskId !== taskId &&
      getWaterTaskStationId(occupiedTask.taskId) === taskStationId
    ) {
      return false;
    }
    return true;
  };

  const toggleWaterTransferSelection = (taskId: string) => {
    if (!canSelectWaterTransferTask(taskId)) return;
    setSelectedWaterTransferTaskId((prev) => (prev === taskId ? null : taskId));
  };

  const dropWaterTaskToLadleSlot = (taskId: string, slot: number) => {
    if (!canAssignWaterTaskToLadleSlot(taskId, slot)) return false;
    const taskStationId = getWaterTaskStationId(taskId);

    setWaterTaskProgress((prev) => {
      const current = prev[taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };
      if (current.status === 'done') return prev;

      const occupiedByOther = waterTasks.some((entry) => {
        if (!entry.requiresLadle || entry.taskId === taskId) return false;
        if (getWaterTaskStationId(entry.taskId) !== taskStationId) return false;
        const progress = prev[entry.taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };
        return progress.status === 'cooking' && progress.ladleSlot === slot;
      });
      if (occupiedByOther) return prev;

      if (current.status === 'queued') {
        return {
          ...prev,
          [taskId]: {
            status: 'cooking',
            startedAt: Date.now(),
            ladleSlot: slot,
          },
        };
      }

      if (current.status === 'cooking') {
        if (!isWaterTaskUnlocked(taskId)) return prev;
        if (current.ladleSlot === slot) return prev;
        return {
          ...prev,
          [taskId]: {
            ...current,
            ladleSlot: slot,
          },
        };
      }

      return prev;
    });
    setWaterUnlockedTaskIds((prev) => prev.filter((entryId) => entryId !== taskId));
    setWaterForceFinishPromptTaskId((prev) => (prev === taskId ? null : prev));
    return true;
  };

  const assignSelectedWaterTaskToLadle = (slot: number) => {
    if (!selectedWaterTransferTaskId) return;
    const assignedTaskId = selectedWaterTransferTaskId;
    const moved = dropWaterTaskToLadleSlot(assignedTaskId, slot);
    if (!moved) return;
    setSelectedWaterTransferTaskId(null);
    setWaterTransferFx({
      taskId: assignedTaskId,
      slot,
      stamp: Date.now(),
      phase: 'show',
    });
  };

  const moveWaterTaskBackToQueue = (taskId: string) => {
    const task = waterTaskMap.get(taskId);
    if (!task || !task.requiresLadle) return;
    setWaterTaskProgress((prev) => {
      const current = prev[taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };
      if (current.status !== 'cooking' || !isWaterTaskUnlocked(taskId)) return prev;
      return {
        ...prev,
        [taskId]: {
          status: 'queued',
          startedAt: null,
          ladleSlot: null,
        },
      };
    });
    setWaterUnlockedTaskIds((prev) => prev.filter((entryId) => entryId !== taskId));
    setWaterForceFinishPromptTaskId((prev) => (prev === taskId ? null : prev));
    setSelectedWaterTransferTaskId((prev) => (prev === taskId ? null : prev));
  };

  const handleWaterFinishProgressTap = (taskId: string, canFinish: boolean) => {
    const progress = getWaterTaskProgress(taskId);
    if (progress.status !== 'cooking') return;

    if (canFinish) {
      completeWaterTask(taskId);
      return;
    }

    const now = Date.now();
    const tracker = waterFinishTapTrackerRef.current;
    if (tracker.taskId === taskId && now - tracker.lastAt <= 420) {
      tracker.count += 1;
    } else {
      tracker.taskId = taskId;
      tracker.count = 1;
    }
    tracker.lastAt = now;

    if (tracker.count >= 3) {
      setWaterForceFinishPromptTaskId(taskId);
      tracker.count = 0;
    }
  };

  const completeWaterTask = (taskId: string, force = false) => {
    const targetTask = waterTaskMap.get(taskId);
    if (!targetTask) return;

    setWaterTaskProgress((prev) => {
      const current = prev[taskId] ?? { status: 'queued', startedAt: null, ladleSlot: null };
      if (current.status !== 'cooking' || !current.startedAt) return prev;
      const elapsedSeconds = Math.floor((Date.now() - current.startedAt) / 1000);
      if (!force && elapsedSeconds < Math.max(1, targetTask.durationSeconds)) return prev;

      return {
        ...prev,
        [taskId]: {
          status: 'done',
          startedAt: null,
          ladleSlot: null,
        },
      };
    });
    setWaterUnlockedTaskIds((prev) => prev.filter((entryId) => entryId !== taskId));
    setWaterForceFinishPromptTaskId((prev) => (prev === taskId ? null : prev));
    if (waterFinishTapTrackerRef.current.taskId === taskId) {
      waterFinishTapTrackerRef.current = {
        taskId: '',
        count: 0,
        lastAt: 0,
      };
    }
  };

  const updateBox = (
    category: BoxOrderCategory,
    boxId: string,
    updater: (prev: BoxSelection) => BoxSelection,
  ) => {
    setBoxState((prev) => ({
      ...prev,
      [category]: prev[category].map((box) => (box.id === boxId ? updater(box) : box)),
    }));
  };

  const handleAddBox = (category: BoxOrderCategory) => {
    const wasEmpty = boxState[category].length === 0;
    const newBox = createBoxSelection('box-20', category);
    setBoxState((prev) => ({
      ...prev,
      [category]: [...prev[category], newBox],
    }));
    setActiveBoxState((prev) => ({
      ...prev,
      [category]: newBox.id,
    }));
    if (wasEmpty) {
      setDockingAddButton(category);
      if (dockAddButtonTimerRef.current !== null) {
        window.clearTimeout(dockAddButtonTimerRef.current);
      }
      dockAddButtonTimerRef.current = window.setTimeout(() => {
        setDockingAddButton((prev) => (prev === category ? null : prev));
      }, 760);
    }
  };

  const handleSelectBox = (category: BoxOrderCategory, boxId: string) => {
    setActiveBoxState((prev) => ({
      ...prev,
      [category]: boxId,
    }));
  };

  const handleRemoveBox = (category: BoxOrderCategory, boxId: string) => {
    setBoxState((prev) => {
      const currentBoxes = prev[category];
      const nextBoxes = currentBoxes.filter((box) => box.id !== boxId);
      setActiveBoxState((active) => ({
        ...active,
        [category]:
          active[category] === boxId
            ? nextBoxes[nextBoxes.length - 1]?.id ?? nextBoxes[0]?.id ?? ''
            : active[category],
      }));
      return {
        ...prev,
        [category]: nextBoxes,
      };
    });
  };

  const handleAdjustFilling = (
    category: BoxOrderCategory,
    boxId: string,
    fillingId: string,
    delta: number,
  ) => {
    updateBox(category, boxId, (box) => {
      const filling = itemMap.get(fillingId);
      if (!filling || filling.category !== category) {
        return box;
      }
      if (delta > 0 && isMenuItemUnavailable(filling.id)) {
        return box;
      }
      const currentCount = box.items.find((entry) => entry.fillingId === fillingId)?.count ?? 0;
      const usedPieces = getBoxUsage(box);
      const availablePieces = Math.max(0, BOX_MAX_PIECES_PER_BOX - usedPieces);
      const boundedDelta = delta > 0 ? Math.min(delta, availablePieces) : delta;
      const newCount = Math.max(0, currentCount + boundedDelta);
      const nextItems = box.items.some((entry) => entry.fillingId === fillingId)
        ? box.items.map((entry) =>
            entry.fillingId === fillingId
              ? { ...entry, count: newCount }
              : entry,
          )
        : [...box.items, { fillingId, count: Math.max(0, boundedDelta) }];

      return {
        ...box,
        items: nextItems.filter((entry) => entry.count > 0),
      };
    });
  };

  const getFastIncrementKey = (category: BoxOrderCategory, boxId: string, fillingId: string) =>
    `${category}:${boxId}:${fillingId}`;

  const triggerFastTapHint = (key: string) => {
    setFastTapHint({ key, stamp: Date.now(), phase: 'show' });
  };

  const handleIncrementTap = (category: BoxOrderCategory, boxId: string, fillingId: string) => {
    handleAdjustFilling(category, boxId, fillingId, 1);

    const now = Date.now();
    const key = getFastIncrementKey(category, boxId, fillingId);
    const tracker = fastTapTrackerRef.current;
    if (tracker.key === key && now - tracker.lastAt < 260) {
      tracker.count += 1;
    } else {
      tracker.key = key;
      tracker.count = 1;
    }
    tracker.lastAt = now;

    if (tracker.count >= 3) {
      triggerFastTapHint(key);
      tracker.count = 0;
    }
  };

  const startIncrementLongPress = (category: BoxOrderCategory, boxId: string, fillingId: string) => {
    const key = getFastIncrementKey(category, boxId, fillingId);
    clearIncrementPressTimers();
    incrementPressDelayRef.current = window.setTimeout(() => {
      suppressNextIncrementClickRef.current = key;
      triggerFastTapHint(key);
      handleAdjustFilling(category, boxId, fillingId, 1);
      incrementPressRepeatRef.current = window.setInterval(() => {
        handleAdjustFilling(category, boxId, fillingId, 1);
      }, 120);
    }, 260);
  };

  const stopIncrementLongPress = () => {
    clearIncrementPressTimers();
  };

  const handleIncrementButtonClick = (category: BoxOrderCategory, boxId: string, fillingId: string) => {
    const key = getFastIncrementKey(category, boxId, fillingId);
    if (suppressNextIncrementClickRef.current === key) {
      suppressNextIncrementClickRef.current = null;
      return;
    }
    handleIncrementTap(category, boxId, fillingId);
  };

  const renderMenuCard = (item: WorkflowMenuItem) => {
    const isPerPiece = item.category === 'potsticker' || item.category === 'dumpling';
    const isExpanded = expandedConfigItemId === item.id;
    const addedPhase = recentlyAdded?.id === item.id ? recentlyAdded.phase : null;
    const availability = getMenuAvailability(item.id);
    const itemUnavailable = availability.unavailable;
    const soupFlavorBasePrice = item.baseDumplingPrice ?? 7;
    const inlineSoupFlavor = availableDumplingFlavors.find((entry) => entry.id === configSoupFlavorId) ?? availableDumplingFlavors[0];
    const inlineSoupSurcharge = item.optionType === 'soup_dumpling_flavor'
      ? Math.max(
          0,
          (item.fixedDumplingCount ?? 8) * ((inlineSoupFlavor?.price ?? soupFlavorBasePrice) - soupFlavorBasePrice),
        )
      : 0;
    const inlineUnitPrice = item.price + inlineSoupSurcharge;
    const quickPieceMode = item.optionType === 'none' && isPerPiece;
    const inlineSubtotal = inlineUnitPrice * Math.max(1, configQuantity);
    const tutorialOpenTargetKey = `menu-add-${item.id}`;
    const tutorialConfirmTargetKey = `menu-confirm-${item.id}`;
    const inCartCount = cartQuantityByMenuItemId.get(item.id) ?? 0;

    return (
      <article
        key={item.id}
        className={`bafang-enter rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-md shadow-amber-100/60 transition-[background-color,border-color,box-shadow,transform] duration-500 ease-out ${
          itemUnavailable ? '' : 'hover:-translate-y-0.5 hover:shadow-lg'
        } ${
          addedPhase === 'pulse'
            ? 'border-emerald-400 bg-emerald-50/80 ring-2 ring-emerald-300/70'
            : addedPhase === 'settle'
              ? 'border-emerald-200 bg-emerald-50/35 ring ring-emerald-200/60'
            : itemUnavailable
              ? 'border-slate-200 bg-slate-100/70'
              : ''
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
              {getCategoryTag(item.category)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">{item.name}</h3>
              {inCartCount > 0 && (
                <span className="inline-flex rounded-full border border-[#2d4770]/30 bg-[#2d4770]/10 px-2 py-0.5 text-[11px] font-semibold text-[#20365a]">
                  已選 {inCartCount}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {item.optionType !== 'none' && <p className="text-xs font-semibold text-amber-700">可加選內容</p>}
              {itemUnavailable && (
                <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                  售完
                </span>
              )}
            </div>
          </div>
          <p className="text-base font-semibold text-slate-900">{currency(item.price)}</p>
        </div>

        <div className="mt-5 space-y-4">
          {quickPieceMode && (
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`${actionButtonBase} ${
                  itemUnavailable
                    ? 'border border-slate-200 bg-slate-100 text-slate-400'
                    : addedPhase
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100'
                      : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                } ${getTutorialFocusClass(tutorialOpenTargetKey)}`}
                ref={(node) => {
                  setTutorialTargetRef(tutorialOpenTargetKey, node);
                }}
                onClick={() => addSimpleItem(item, 1)}
                disabled={itemUnavailable}
              >
                +1 顆
              </button>
              <button
                className={`${actionButtonBase} ${
                  itemUnavailable
                    ? 'bg-slate-300 text-slate-500'
                    : addedPhase
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}
                onClick={() => addSimpleItem(item, 5)}
                disabled={itemUnavailable}
              >
                +5 顆
              </button>
            </div>
          )}

          {!quickPieceMode && (
            <>
              <button
                className={`${actionButtonBase} w-full text-white transition-all duration-300 ${
                  itemUnavailable
                    ? 'bg-slate-300 text-slate-500'
                    : isExpanded
                      ? 'bg-slate-700 hover:bg-slate-800'
                      : addedPhase
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-amber-500 hover:bg-amber-600'
                } ${getTutorialFocusClass(tutorialOpenTargetKey)}`}
                ref={(node) => {
                  setTutorialTargetRef(tutorialOpenTargetKey, node);
                }}
                onClick={() => {
                  toggleInlineConfigurator(item);
                }}
                disabled={itemUnavailable}
              >
                {itemUnavailable ? '售完' : isExpanded ? '收合' : '加入購物車'}
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity,margin] duration-500 ease-out ${
                  isExpanded
                    ? 'mt-5 grid-rows-[1fr] opacity-100 overflow-visible'
                    : 'grid-rows-[0fr] opacity-0 overflow-hidden'
                }`}
              >
                <div className="min-h-0 pt-2">
                  <div className="space-y-5 rounded-2xl border border-amber-100 bg-amber-50/70 p-5 sm:p-6">
                    <p className="text-sm font-semibold text-amber-800">
                      {item.optionType === 'none' ? '設定數量/備註' : '先選內容，再設定數量/備註'}
                    </p>

                    {item.optionType === 'tofu_sauce' && (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-slate-800">涼拌豆腐口味</p>
                        <div className="grid grid-cols-2 gap-3">
                          {(['麻醬', '蠔油'] as TofuSauce[]).map((sauce) => (
                            <button
                              key={sauce}
                              onClick={() => setConfigTofuSauce(sauce)}
                              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition ${
                                configTofuSauce === sauce
                                  ? 'border-amber-500 bg-amber-50 text-amber-900'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                              }`}
                            >
                              {sauce}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.optionType === 'noodle_staple' && (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-slate-800">主食選擇</p>
                        <div className="grid grid-cols-2 gap-3">
                          {(['麵條', '冬粉'] as NoodleStaple[]).map((staple) => (
                            <button
                              key={staple}
                              onClick={() => setConfigNoodleStaple(staple)}
                              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition ${
                                configNoodleStaple === staple
                                  ? 'border-amber-500 bg-amber-50 text-amber-900'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                              }`}
                            >
                              {staple}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.optionType === 'soup_dumpling_flavor' && (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-slate-800">
                          湯餃口味（固定 {item.fixedDumplingCount ?? 8} 顆）
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {dumplingFlavorOptions.map((flavor) => {
                            const flavorSurchargePerPiece = Math.max(0, flavor.price - soupFlavorBasePrice);
                            return (
                              <button
                                key={flavor.id}
                                onClick={() => {
                                  if (flavor.soldOut) return;
                                  setConfigSoupFlavorId(flavor.id);
                                }}
                                disabled={flavor.soldOut}
                                className={`min-h-11 rounded-xl border px-3 text-left text-sm font-semibold transition ${
                                  flavor.soldOut
                                    ? 'border-slate-200 bg-slate-100 text-slate-400'
                                    : configSoupFlavorId === flavor.id
                                      ? 'border-amber-500 bg-amber-50 text-amber-900'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p>{flavor.name}</p>
                                  {flavor.soldOut && <span className="text-[11px] font-semibold text-rose-600">售完</span>}
                                </div>
                                {flavorSurchargePerPiece > 0 && (
                                  <p className={`text-[11px] font-medium ${flavor.soldOut ? 'text-slate-400' : 'text-emerald-700'}`}>
                                    +{formatDelta(flavorSurchargePerPiece)} 元 / 顆
                                  </p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-800">數量</p>
                        <div className="inline-flex w-full items-center rounded-xl border border-slate-200 bg-white p-1">
                          <button
                            type="button"
                            onClick={() => setConfigQuantity((prev) => Math.max(1, prev - 1))}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={configQuantity <= 1}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={MAX_CONFIG_QUANTITY}
                            value={configQuantity}
                            onChange={(event) => {
                              const parsed = Number(event.target.value);
                              if (!Number.isFinite(parsed)) return;
                              setConfigQuantity(Math.max(1, Math.min(MAX_CONFIG_QUANTITY, Math.round(parsed))));
                            }}
                            className="h-10 w-full border-0 bg-transparent px-2 text-center text-sm font-semibold text-slate-900 focus:outline-none [appearance:textfield]"
                          />
                          <button
                            type="button"
                            onClick={() => setConfigQuantity((prev) => Math.min(MAX_CONFIG_QUANTITY, prev + 1))}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-amber-200 bg-amber-100 text-lg font-semibold text-amber-800 transition hover:border-amber-300 hover:bg-amber-200"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-slate-800">備註</span>
                        <input
                          type="text"
                          value={configNote}
                          maxLength={40}
                          onChange={(event) => setConfigNote(event.target.value)}
                          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl bg-[#1f3356] px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[11px] text-slate-300">本次小計</p>
                        <p className="text-lg font-semibold">{currency(inlineSubtotal)}</p>
                        <p className="text-xs font-medium text-slate-300">{Math.max(1, configQuantity)} 份</p>
                      </div>
                      <button
                        className={`${actionButtonBase} w-full bg-amber-500 text-white hover:bg-amber-600 sm:w-auto ${getTutorialFocusClass(tutorialConfirmTargetKey)}`}
                        ref={(node) => {
                          setTutorialTargetRef(tutorialConfirmTargetKey, node);
                        }}
                        onClick={() => confirmConfigurator(item)}
                        disabled={item.optionType === 'soup_dumpling_flavor' && availableDumplingFlavors.length === 0}
                      >
                        加入購物車
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </article>
    );
  };

  const renderBoxOrdering = (category: BoxOrderCategory) => {
    const boxes = boxState[category];
    const currentActiveId = activeBoxState[category];
    const currentActiveBox = boxes.find((entry) => entry.id === currentActiveId) ?? boxes[0] ?? null;
    const categoryPricingPool = availableFillingItems[category].length > 0
      ? availableFillingItems[category]
      : fillingItems[category];
    const categoryBasePrice = categoryPricingPool.length > 0
      ? categoryPricingPool.reduce(
        (min, item) => Math.min(min, item.price),
        Number.POSITIVE_INFINITY,
      )
      : 0;

    if (boxes.length === 0) {
      return (
        <div
          ref={(node) => {
            if (activeCategory === category) {
              boxSectionRef.current = node;
            }
          }}
          className={`${cardClass} space-y-6`}
        >
          <div className="text-center">
            <p className="text-sm font-medium text-slate-600">目前{category === 'potsticker' ? '鍋貼' : '水餃'}盒數</p>
            <p className="text-2xl font-semibold text-slate-900">0 盒</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              基礎單價 {currency(categoryBasePrice)} / 顆
            </p>
          </div>

          <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-amber-200 bg-amber-50/50 p-4">
            <button
              className={`${actionButtonBase} bafang-addbox-hero min-h-14 w-full max-w-[280px] bg-amber-500 px-6 text-base text-white hover:bg-amber-600 ${getTutorialFocusClass(`box-add-hero-${category}`)}`}
              ref={(node) => {
                setTutorialTargetRef(`box-add-hero-${category}`, node);
              }}
              onClick={() => handleAddBox(category)}
            >
              {category === 'potsticker' ? '開始你的第一盒鍋貼' : '開始你的第一盒水餃'}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={(node) => {
          if (activeCategory === category) {
            boxSectionRef.current = node;
          }
        }}
        className={`${cardClass} space-y-6`}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">目前{category === 'potsticker' ? '鍋貼' : '水餃'}盒數</p>
            <p className="text-2xl font-semibold text-slate-900">{boxes.length} 盒</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              基礎單價 {currency(categoryBasePrice)} / 顆
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              className={`${actionButtonBase} border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 ${
                dockingAddButton === category ? 'bafang-addbox-dock' : ''
              } ${getTutorialFocusClass(`box-add-dock-${category}`)}`}
              ref={(node) => {
                setTutorialTargetRef(`box-add-dock-${category}`, node);
              }}
              onClick={() => handleAddBox(category)}
            >
              新增盒子
            </button>
            {currentActiveBox && (
              <button
                className={`${actionButtonBase} border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100`}
                onClick={() => handleRemoveBox(category, currentActiveBox.id)}
              >
                移除當前盒
              </button>
            )}
          </div>
        </div>

        <div className="-mx-1 overflow-x-auto px-1 py-2 pb-4 overscroll-x-contain bafang-soft-scroll">
          <div className="flex min-w-full flex-nowrap gap-4 scroll-px-1">
            {boxes.map((box, index) => {
              const usage = getBoxUsage(box);
              const isActive = box.id === currentActiveBox?.id;
              return (
                <button
                  key={box.id}
                  ref={(node) => {
                    setTutorialTargetRef(`box-card-${box.id}`, node);
                  }}
                  onClick={() => handleSelectBox(category, box.id)}
                  className={`min-h-32 min-w-[196px] shrink-0 rounded-2xl border px-4 py-4 text-left transition-all duration-300 sm:min-w-[224px] md:min-w-[236px] ${
                    isActive
                      ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-300/70 shadow-md shadow-amber-200/70'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  } ${getTutorialFocusClass(`box-card-${box.id}`)}`}
                >
                  <p className="text-sm font-semibold">盒 #{index + 1}</p>
                  <p className="text-sm font-medium">{usage} 顆 / {BOX_MAX_PIECES_PER_BOX} 顆</p>
                  <p className="mt-1 h-4 text-[11px] font-semibold text-slate-500">
                    單盒上限 20 顆
                  </p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-widest text-slate-500">
                    {category === 'potsticker' ? '鍋貼盒' : '水餃盒'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {currentActiveBox && (
          <div className="space-y-6 rounded-2xl border border-amber-100 bg-amber-50/80 p-5 sm:p-6">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-amber-800">
                <span>盒內顆數</span>
                <span>{getBoxUsage(currentActiveBox)} / {BOX_MAX_PIECES_PER_BOX}</span>
              </div>
              <div className="h-2 rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{
                    width: `${
                      Math.min(100, (getBoxUsage(currentActiveBox) / BOX_MAX_PIECES_PER_BOX) * 100)
                    }%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] font-semibold text-amber-700">單盒最多 {BOX_MAX_PIECES_PER_BOX} 顆</p>
            </div>

            <div className="space-y-5">
              <p className="text-sm font-semibold text-slate-800">調整品項數量</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {fillingItems[category].map((item) => {
                  const availability = getMenuAvailability(item.id);
                  const itemUnavailable = availability.unavailable;
                  const currentCount = currentActiveBox.items.find((entry) => entry.fillingId === item.id)?.count ?? 0;
                  const canIncrement = !itemUnavailable;
                  const canDecrement = currentCount > 0;
                  const surchargePerPiece = Math.max(0, item.price - categoryBasePrice);
                  const incrementHintKey = getFastIncrementKey(category, currentActiveBox.id, item.id);
                  const showIncrementHint = fastTapHint?.key === incrementHintKey;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-2xl border px-4 py-4 shadow-sm ${
                        itemUnavailable
                          ? 'border-slate-200 bg-slate-100/80'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-sm font-semibold ${itemUnavailable ? 'text-slate-600' : 'text-slate-900'}`}>{item.name}</p>
                            {itemUnavailable && (
                              <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                售完
                              </span>
                            )}
                          </div>
                          {surchargePerPiece > 0 && (
                            <p className={`text-[11px] font-medium ${itemUnavailable ? 'text-slate-400' : 'text-emerald-700'}`}>
                              +{formatDelta(surchargePerPiece)} 元 / 顆
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-2">
                            <button
                              className="bafang-press-control inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                              onClick={() => handleAdjustFilling(category, currentActiveBox.id, item.id, -1)}
                              disabled={!canDecrement}
                            >
                              −
                            </button>
                            <span className="min-w-[2rem] text-center text-sm font-semibold text-slate-900">{currentCount}</span>
                            <button
                              className={`bafang-press-control inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-lg font-semibold text-white transition hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 ${getTutorialFocusClass(`box-fill-plus-${item.id}`)}`}
                              ref={(node) => {
                                setTutorialTargetRef(`box-fill-plus-${item.id}`, node);
                              }}
                              onClick={() => handleIncrementButtonClick(category, currentActiveBox.id, item.id)}
                              onPointerDown={() => startIncrementLongPress(category, currentActiveBox.id, item.id)}
                              onPointerUp={stopIncrementLongPress}
                              onPointerLeave={stopIncrementLongPress}
                              onPointerCancel={stopIncrementLongPress}
                              onContextMenu={(event) => event.preventDefault()}
                              disabled={!canIncrement}
                            >
                              +
                            </button>
                          </div>
                          <p className={`h-4 text-[11px] font-medium text-slate-500 transition-all duration-500 ${
                            showIncrementHint && !itemUnavailable
                              ? fastTapHint?.phase === 'show'
                                ? 'opacity-100 translate-y-0'
                                : 'opacity-0 -translate-y-1'
                              : 'opacity-0'
                          }`}>
                            可長按 + 快速增加
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPackagingWorkspace = () => {
    const packagingLaneStations = effectivePackagingStations;
    const activePackagingLaneIndex = Math.max(
      0,
      packagingLaneStations.findIndex((station) => station.id === activePackagingLane),
    );
    const packagingLaneStep = 100 / Math.max(1, packagingLaneStations.length);
    const useCompactPackagingLaneSwitcher = isPackagingStationMode && packagingLaneStations.length > 1;
    const getChecklistItems = (orderId: string) => packagingChecklistByOrderId.get(orderId) ?? [];
    const getChecklistGroups = (orderId: string) => {
      const categoryOrder: Record<string, number> = {
        potsticker: 0,
        dumpling: 1,
        soup_dumpling: 2,
        side: 3,
        soup: 4,
        noodle: 5,
        drink: 6,
      };
      const groupMap = new Map<string, {
        key: string;
        categoryKey: string;
        label: string;
        items: PackagingChecklistItem[];
      }>();

      getChecklistItems(orderId).forEach((item) => {
        const groupByLine = item.categoryKey === 'noodle' || item.categoryKey === 'soup_dumpling';
        const groupKey = groupByLine
          ? `${item.categoryKey}:${item.groupKey}`
          : item.categoryKey;
        const existing = groupMap.get(groupKey);
        if (existing) {
          existing.items.push(item);
          return;
        }
        groupMap.set(groupKey, {
          key: groupKey,
          categoryKey: item.categoryKey,
          label: groupByLine ? item.groupLabel : item.categoryLabel,
          items: [item],
        });
      });

      return Array.from(groupMap.values()).sort(
        (a, b) =>
          (categoryOrder[a.categoryKey] ?? 99) - (categoryOrder[b.categoryKey] ?? 99) ||
          a.label.localeCompare(b.label),
      );
    };

    const getChecklistDisplayLabel = (item: PackagingChecklistItem) => item.label;

    const formatEtaCompact = (seconds: number) => {
      const safe = Math.max(0, Math.round(seconds));
      if (safe >= 60) {
        const minutes = Math.floor(safe / 60);
        const remainSeconds = safe % 60;
        return `${String(minutes).padStart(2, '0')}m${String(remainSeconds).padStart(2, '0')}s`;
      }
      return `${safe}s`;
    };

    const getEtaCompactLabel = (
      status: PackagingItemTrackStatus,
      etaSeconds: number | null,
    ) => {
      if (etaSeconds === null) return null;
      if (status !== 'in_progress') return null;
      return formatEtaCompact(etaSeconds);
    };

    const getOrderChecklistMetrics = (order: SubmittedOrder) => {
      const groups = getChecklistGroups(order.id);
      const checklist = groups.flatMap((group) => group.items);
      const effectiveStatuses = checklist.map((item) => getPackagingItemEffectiveStatus(order.id, item));
      const packedCount = effectiveStatuses.filter((status) => status === 'packed').length;
      const blockingItems = checklist.filter((item) => {
        const status = getPackagingItemEffectiveStatus(order.id, item);
        return status === 'queued' || status === 'in_progress' || status === 'issue';
      });
      const inProgressItems = checklist.filter(
        (item) => getPackagingItemEffectiveStatus(order.id, item) === 'in_progress',
      );
      return {
        groups,
        checklist,
        packedCount,
        blockingItems,
        inProgressItems,
      };
    };

    const renderServeButton = (order: SubmittedOrder, className: string) => {
      const served = getPackagingStatus(order.id) === 'served';
      return (
        <button
          type="button"
          onClick={() => setPackagingStatus(order.id, 'served')}
          disabled={served}
          className={`${className} inline-flex w-full items-center justify-center rounded-xl border text-base font-bold transition ${
            served
              ? 'cursor-not-allowed border-emerald-300 bg-emerald-100 text-emerald-700'
              : 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
          }`}
        >
          {served ? '已完成' : '出餐'}
        </button>
      );
    };

    const renderChecklistPartRow = (
      order: SubmittedOrder,
      item: PackagingChecklistItem,
      allowToggle: boolean,
      detailLevel: 'md' | 'lg',
    ) => {
      const isLarge = detailLevel === 'lg';
      const effectiveStatus = getPackagingItemEffectiveStatus(order.id, item);
      const checked = effectiveStatus === 'packed';
      const rowConfirmKey = `${order.id}:${item.key}`;
      const queuedNeedsDoubleTap = effectiveStatus === 'queued';
      const queuedTapArmed = packagingQueuedTapArmedKey === rowConfirmKey;
      const progressPercent = effectiveStatus === 'in_progress'
        ? Math.max(8, Math.min(100, Math.round(item.progressPercent ?? 12)))
        : 0;
      const partLabel = item.partLabel ?? item.label;
      const quantityLabel = item.quantityUnit ? `${item.quantity}${item.quantityUnit}` : `× ${item.quantity}`;
      const etaCompactLabel = getEtaCompactLabel(effectiveStatus, item.etaSeconds);
      const serviceModeStripeClass = item.showServiceModeTag
        ? `border-l-[6px] ${waterServiceModeStripeClass(order.serviceMode)}`
        : '';
      const rowVisualClass = checked
        ? 'border-emerald-300 bg-emerald-50/80'
        : effectiveStatus === 'issue'
          ? 'border-rose-200 bg-rose-50/80'
        : effectiveStatus === 'in_progress'
            ? 'border-sky-300 bg-sky-50/85'
            : effectiveStatus === 'ready'
              ? 'border-amber-300 bg-amber-50/85'
              : effectiveStatus === 'queued'
                ? 'border-rose-300 bg-rose-100/85'
                : 'border-slate-200 bg-white/95';
      const rowHoverClass = allowToggle && !checked
        ? effectiveStatus === 'in_progress'
          ? 'hover:border-sky-300'
          : effectiveStatus === 'issue'
            ? 'hover:border-rose-300'
            : effectiveStatus === 'queued'
              ? 'hover:border-rose-400'
              : 'hover:border-amber-300 hover:bg-amber-50/45'
        : '';
      const rowContent = (
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold transition ${
              checked
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-slate-300 bg-white text-transparent'
            }`}>
              ✓
            </span>
            <div className="min-w-0">
              <p className={`${isLarge ? 'text-base' : 'text-sm'} font-semibold leading-tight ${
                checked ? 'text-slate-500 line-through' : 'text-slate-900'
              }`}>
                {quantityLabel}
                {' '}
                {partLabel}
              </p>
              {item.detail && (
                <p className={`mt-1 ${isLarge ? 'text-sm' : 'text-xs'} font-semibold ${checked ? 'text-slate-400' : 'text-slate-700'}`}>
                  {item.detail}
                </p>
              )}
              {item.note && (
                <p className={`mt-1 ${isLarge ? 'text-sm' : 'text-xs'} font-medium ${checked ? 'text-slate-400' : 'text-slate-600'}`}>
                  {item.note}
                </p>
              )}
            </div>
          </div>
          {etaCompactLabel && (
            <p className={`${isLarge ? 'text-sm' : 'text-xs'} shrink-0 font-semibold text-slate-500`}>
              {etaCompactLabel}
            </p>
          )}
        </div>
      );

      if (!allowToggle) {
        return (
          <div key={`packaging-checklist-${order.id}-${item.key}`} className={`relative overflow-hidden rounded-xl border ${isLarge ? 'px-3.5 py-3' : 'px-3 py-2.5'} ${rowVisualClass} ${serviceModeStripeClass}`}>
            {effectiveStatus === 'in_progress' && (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 bg-sky-300/45 transition-[width] duration-300 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            )}
            <div className="relative z-10 flex items-start justify-between gap-2">
              {rowContent}
            </div>
          </div>
        );
      }

      return (
        <button
          key={`packaging-checklist-${order.id}-${item.key}`}
          type="button"
          onClick={() => {
            if (queuedNeedsDoubleTap && !queuedTapArmed) {
              armPackagingQueuedTap(rowConfirmKey);
              return;
            }
            if (queuedNeedsDoubleTap) {
              clearPackagingQueuedTapArmed();
            }
            togglePackagingChecklistItem(order.id, item);
          }}
          className={`relative w-full overflow-hidden rounded-xl border ${isLarge ? 'px-3.5 py-3' : 'px-3 py-2.5'} text-left transition-all duration-200 ${rowVisualClass} ${serviceModeStripeClass} ${rowHoverClass}`}
        >
          {effectiveStatus === 'in_progress' && (
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-sky-300/45 transition-[width] duration-300 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          )}
          <div className="relative z-10 flex items-start justify-between gap-2">{rowContent}</div>
        </button>
      );
    };

    const renderChecklistGroupCard = (
      order: SubmittedOrder,
      group: {
        key: string;
        label: string;
        items: PackagingChecklistItem[];
      },
      allowToggle: boolean,
      detailLevel: 'md' | 'lg',
    ) => {
      const isLarge = detailLevel === 'lg';
      const packedPartCount = group.items.filter(
        (item) => getPackagingItemEffectiveStatus(order.id, item) === 'packed',
      ).length;

      return (
        <div key={`packaging-group-${order.id}-${group.key}`} className={`rounded-xl border border-slate-200 bg-white/95 ${isLarge ? 'p-3.5' : 'p-3'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`truncate ${isLarge ? 'text-base' : 'text-sm'} font-semibold text-slate-900`}>{group.label}</p>
            </div>
            <p className={`${isLarge ? 'text-sm' : 'text-xs'} font-semibold text-slate-600`}>
              {packedPartCount}/{group.items.length}
            </p>
          </div>
          <div className="mt-2 space-y-1.5">
            {group.items.map((item) =>
              renderChecklistPartRow(order, item, allowToggle, detailLevel),
            )}
          </div>
        </div>
      );
    };

    const renderTopQueueCard = (order: SubmittedOrder, detailLevel: 'md' | 'lg') => {
      const orderStatus = getPackagingStatus(order.id);
      const statusMeta = PACKAGING_STATUS_META[orderStatus];
      const orderNote = getOrderWorkflowNote(order);
      const {
        groups,
        checklist,
        packedCount,
      } = getOrderChecklistMetrics(order);
      const isPinned = packagingPinnedOrderIds.includes(order.id);
      const visibleGroups = groups;
      const isFull = detailLevel === 'lg';

      return (
        <article
          key={`packaging-top-${order.id}`}
          className={`rounded-2xl border shadow-sm ${isFull ? 'p-4' : 'p-3'} ${statusMeta.panelClass}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className={`${isFull ? 'text-2xl' : 'text-lg'} font-semibold text-slate-900`}>{order.id}</p>
                {isPinned && (
                  <span className={`inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 ${isFull ? 'text-xs' : 'text-[11px]'} font-semibold text-sky-700`}>
                    手動拉入
                  </span>
                )}
              </div>
              {orderNote && (
                <p className={`${isFull ? 'mt-1 text-sm' : 'mt-1 text-xs'} font-semibold text-[#20365a]`}>
                  {orderNote}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end">
              <p className={`${isFull ? 'text-sm' : 'text-xs'} font-semibold text-slate-600`}>
                {packedCount}/{checklist.length}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {visibleGroups.map((group) => renderChecklistGroupCard(order, group, true, detailLevel))}
            {checklist.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-sm font-medium text-slate-500">
                無項目
              </div>
            )}
          </div>

          <div className="mt-3 flex justify-end">
            <div className={`w-full ${isFull ? 'max-w-[240px]' : 'max-w-[220px]'}`}>
              {renderServeButton(order, isFull ? 'h-14 shadow-sm text-lg' : 'h-11')}
            </div>
          </div>
        </article>
      );
    };

    const renderOtherOrderCard = (order: SubmittedOrder) => {
      const orderStatus = getPackagingStatus(order.id);
      const statusMeta = PACKAGING_STATUS_META[orderStatus];
      const orderNote = getOrderWorkflowNote(order);
      const { groups, checklist, packedCount, blockingItems, inProgressItems } = getOrderChecklistMetrics(order);
      const previewItems = groups.slice(0, 2);
      const draggable = orderStatus === 'waiting_pickup';
      const isPinned = packagingPinnedOrderIds.includes(order.id);
      return (
        <article
          key={`packaging-other-${order.id}`}
          draggable={draggable}
          onDragStart={(event) => handlePackagingOrderDragStart(event, order.id)}
          onDragEnd={clearPackagingDragState}
          className={`rounded-2xl border p-3 shadow-sm ${statusMeta.panelClass} ${
            draggable ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-base font-semibold text-slate-900">{order.id}</p>
                {isPinned && (
                  <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                    手動拉入
                  </span>
                )}
              </div>
              {orderNote && (
                <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold text-[#20365a]">
                  {orderNote}
                </p>
              )}
            </div>
          </div>
          <div className="mt-2 space-y-1 text-xs font-medium text-slate-700">
            {previewItems.map((group) => (
              <p key={`packaging-other-item-${order.id}-${group.key}`} className="truncate">
                {group.label} · {group.items.length}
              </p>
            ))}
            {groups.length > previewItems.length && (
              <p className="text-slate-500">+{groups.length - previewItems.length} 組</p>
            )}
            {checklist.length === 0 && <p className="text-slate-500">無明細</p>}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-semibold">
            <p className="text-slate-600">{packedCount}/{checklist.length}</p>
            {blockingItems.length > 0 ? (
              <p className="text-rose-600">缺 {blockingItems.length}</p>
            ) : (
              <p className="text-emerald-600">已齊</p>
            )}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-slate-600">
            製作中 {inProgressItems.length}
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => pinPackagingOrderToTopQueue(order.id)}
              disabled={orderStatus !== 'waiting_pickup'}
              className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-sky-300 bg-sky-50 px-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400"
            >
              拉到待打包
            </button>
          </div>
          <div className="mt-2">
            {renderServeButton(order, 'h-11')}
          </div>
        </article>
      );
    };

    const topQueueCardWidthClass =
      packagingTopQueueSize === 'lg'
        ? 'min-w-[84vw] snap-start sm:min-w-[68vw] md:min-w-[54vw] lg:min-w-[44vw] xl:min-w-[420px] 2xl:min-w-[460px]'
        : 'min-w-[72vw] snap-start sm:min-w-[58vw] md:min-w-[44vw] lg:min-w-[34vw] xl:min-w-[360px] 2xl:min-w-[400px]';

    return (
      <section className="space-y-5 sm:space-y-6">
        <section className={`${cardClass} bafang-enter space-y-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">包裝作業</h2>
            </div>
            {!workspaceFullscreen && useCompactPackagingLaneSwitcher && (
              <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-amber-200 bg-amber-50/85 p-1">
                {packagingLaneStations.map((lane) => (
                  <button
                    key={`packaging-mini-lane-tab-${lane.id}`}
                    type="button"
                    onClick={() => setActivePackagingLane(lane.id)}
                    className={`h-8 min-w-14 rounded-lg px-2 text-xs font-semibold transition ${
                      activePackagingLane === lane.id
                        ? 'bg-amber-500 text-white'
                        : 'bg-white text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    {lane.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!workspaceFullscreen && packagingLaneStations.length > 1 && !useCompactPackagingLaneSwitcher && (
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/75 p-1 shadow-sm">
              <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
                <div
                  className="h-full rounded-xl bg-gradient-to-r from-amber-500/90 to-amber-400/90 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    width: `${packagingLaneStep}%`,
                    transform: `translateX(${activePackagingLaneIndex * 100}%)`,
                  }}
                />
              </div>
              <div
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${packagingLaneStations.length}, minmax(0, 1fr))` }}
              >
                {packagingLaneStations.map((lane) => (
                  <button
                    key={`packaging-lane-tab-${lane.id}`}
                    type="button"
                    onClick={() => setActivePackagingLane(lane.id)}
                    className={`${railButtonBase} ${activePackagingLane === lane.id ? 'text-white' : 'text-slate-700'}`}
                  >
                    {lane.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <section
              onDragOver={handlePackagingTopQueueDragOver}
              onDragLeave={() => setPackagingDropActive(false)}
              onDrop={handlePackagingTopQueueDrop}
              className={`rounded-2xl border border-amber-200 bg-amber-50/70 p-4 transition ${packagingDropActive ? 'ring-2 ring-amber-300' : ''}`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-amber-900">
                    待打包
                    {packagingLaneStations.length > 1
                      ? ` · ${getPackagingLaneLabel(activePackagingLane)}`
                      : ''}
                  </h3>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-amber-200 bg-white/90 px-3 py-2">
                    <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-amber-200 bg-amber-50">
                      {([
                        { id: 'md', label: '中' },
                        { id: 'lg', label: '大' },
                      ] as const).map((option) => (
                        <button
                          key={`packaging-size-${option.id}`}
                          type="button"
                          onClick={() => setPackagingTopQueueSize(option.id)}
                          className={`h-8 min-w-8 px-2 text-xs font-semibold transition ${
                            packagingTopQueueSize === option.id
                              ? 'bg-amber-500 text-white'
                              : 'text-amber-800 hover:bg-amber-100'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="rounded-xl border border-amber-200 bg-white/90 px-3 py-2">
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => nudgePackagingTopQueueLimit(-1)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-sm font-bold text-amber-800 transition hover:bg-amber-100"
                        aria-label="減少顯示張數"
                      >
                        -
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={packagingTopQueueLimitInput}
                        onChange={(event) => updatePackagingTopQueueLimitInput(event.target.value)}
                        onBlur={commitPackagingTopQueueLimitInput}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          commitPackagingTopQueueLimitInput();
                          event.currentTarget.blur();
                        }}
                        className="h-8 w-20 rounded-md border border-amber-300 bg-white px-2 text-center text-sm font-semibold text-amber-900 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => nudgePackagingTopQueueLimit(1)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-sm font-bold text-amber-800 transition hover:bg-amber-100"
                        aria-label="增加顯示張數"
                      >
                        +
                      </button>
                      <span className="text-xs font-semibold text-amber-800">
                        {packagingTopQueueOrders.length}/{packagingOrdersSorted.length}
                      </span>
                    </div>
                  </label>
                </div>
              </div>
              {packagingDropActive && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-white/90 px-3 py-1 text-xs font-semibold text-amber-800">
                  放開加入
                </div>
              )}
              <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 overscroll-x-contain scroll-px-1 bafang-soft-scroll">
                {packagingTopQueueOrders.map((order) => (
                  <div key={`packaging-top-horizontal-${order.id}`} className={topQueueCardWidthClass}>
                    {renderTopQueueCard(order, packagingTopQueueSize)}
                  </div>
                ))}
                {packagingTopQueueOrders.length === 0 && (
                  <div className="w-full rounded-xl border border-dashed border-amber-300 bg-white/80 px-4 py-8 text-center text-sm font-medium text-amber-800">
                    無待打包
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-900">其他</h3>
                <p className="text-sm font-semibold text-slate-700">{packagingOtherOrders.length}</p>
              </div>
              <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 overscroll-x-contain scroll-px-1 bafang-soft-scroll">
                {packagingOtherOrders.map((order) => (
                  <div key={`packaging-other-horizontal-${order.id}`} className="min-w-[70vw] snap-start sm:min-w-[52vw] md:min-w-[40vw] lg:min-w-[30vw] xl:min-w-[280px] 2xl:min-w-[300px]">
                    {renderOtherOrderCard(order)}
                  </div>
                ))}
                {packagingOtherOrders.length === 0 && (
                  <div className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm font-medium text-slate-500">
                    無其他
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>

        <section className={`${cardClass} bafang-enter space-y-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">檔案</h3>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              {packagingSearchResults.length}/{packagingWorkflowOrdersSorted.length} · {archivedOrderIds.length}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <input
              type="search"
              value={packagingSearchKeyword}
              onChange={(event) => setPackagingSearchKeyword(event.target.value)}
              placeholder="搜尋"
              className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
            />
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              封存
            </div>
          </div>

          <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1 md:max-h-[560px] bafang-soft-scroll">
            {packagingSearchResults.map((order) => {
              const status = getPackagingStatus(order.id);
              const statusMeta = PACKAGING_STATUS_META[status];
              const { checklist, packedCount, blockingItems, inProgressItems } = getOrderChecklistMetrics(order);
              const isArchiving = archivingOrderIds.includes(order.id);
              const isExpanded = expandedWorkflowOrderId === order.id;
              const orderNote = getOrderWorkflowNote(order);
              return (
                <article
                  key={`packaging-file-row-${order.id}`}
                  className={`rounded-2xl border p-3 transition-all duration-300 ${statusMeta.panelClass} ${
                    isArchiving ? 'pointer-events-none -translate-y-1 scale-[0.985] opacity-0' : ''
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedWorkflowOrderId((prev) => (prev === order.id ? null : order.id))}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                      isExpanded
                        ? 'border-slate-300 bg-white shadow-sm'
                        : 'border-slate-200 bg-white/90 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-base font-semibold text-slate-900">{order.id}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold ${statusMeta.chipClass}`}>
                        {statusMeta.label}
                      </span>
                    </div>
                  </button>

                  <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                    isExpanded ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}>
                    <div className="min-h-0 overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <p className="font-medium text-slate-600">
                          {new Date(order.createdAt).toLocaleString('zh-TW')} · {serviceModeLabel(order.serviceMode)}
                        </p>
                        <p className="font-semibold text-slate-700">
                          核對 {packedCount}/{checklist.length}
                        </p>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-600">
                        待完成 {blockingItems.length} · 製作中 {inProgressItems.length}
                      </p>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => archiveWorkflowOrder(order.id)}
                          disabled={isArchiving}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {isArchiving ? '封存中...' : '封存訂單'}
                        </button>
                      </div>

                      <label className="mt-2 block space-y-1">
                        <span className="text-xs font-semibold text-slate-600">整筆訂單備註</span>
                        <input
                          type="text"
                          value={orderNote}
                          maxLength={120}
                          onChange={(event) => updateWorkflowOrderNote(order.id, event.target.value)}
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 focus:border-amber-400 focus:outline-none"
                        />
                      </label>

                      <div className="mt-2 space-y-2">
                        {checklist.map((item) => {
                          const effectiveStatus = getPackagingItemEffectiveStatus(order.id, item);
                          const etaCompactLabel = getEtaCompactLabel(effectiveStatus, item.etaSeconds);
                          const serviceModeStripeClass = item.showServiceModeTag
                            ? `border-l-[6px] ${waterServiceModeStripeClass(order.serviceMode)}`
                            : '';
                          const quantityLabel = item.quantityUnit ? `${item.quantity}${item.quantityUnit}` : `× ${item.quantity}`;
                          return (
                            <div key={`packaging-file-item-${order.id}-${item.key}`} className={`rounded-xl border border-slate-200 bg-white px-3 py-2 ${serviceModeStripeClass}`}>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">
                                  {getChecklistDisplayLabel(item)}
                                  {` ${quantityLabel}`}
                                  {etaCompactLabel ? ` · ${etaCompactLabel}` : ''}
                                </p>
                                {item.detail && (
                                  <p className="mt-0.5 text-xs font-semibold text-slate-700">{item.detail}</p>
                                )}
                                {item.note && (
                                  <p className="mt-0.5 text-xs font-medium text-slate-500">{item.note}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {checklist.length === 0 && (
                          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
                            無項目
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
            {packagingSearchResults.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm font-medium text-slate-500">
                無結果
              </div>
            )}
          </div>
        </section>
      </section>
    );
  };

  const renderProductionWorkspace = () => {
    const lockedProductionSection = isProductionStationMode
      ? lockedProductionStationTarget?.section ?? productionSection
      : null;
    const productionTabSections = isProductionStationMode && lockedProductionSection
      ? [lockedProductionSection]
      : availableProductionSections;
    const productionTabs: Array<{ id: ProductionSection; label: string }> = productionTabSections.map((sectionId) => ({
      id: sectionId,
      label: PRODUCTION_MODULE_LABEL[sectionId],
    }));
    const productionTabIndex = Math.max(
      0,
      productionTabs.findIndex((tab) => tab.id === productionSection),
    );
    const productionTabStep = 100 / Math.max(1, productionTabs.length);
    const sectionStations = productionStationsByModule[productionSection];
    const hasSecondaryStationRail = !isProductionStationMode && sectionStations.length > 1;
    const activeSectionStationIndex = isProductionStationMode &&
      lockedProductionStationTarget &&
      lockedProductionStationTarget.section === productionSection
      ? lockedProductionStationTarget.stationIndex
      : Math.min(
        activeProductionStationIndexBySection[productionSection] ?? 0,
        Math.max(0, sectionStations.length - 1),
      );
    const activeSectionStation = sectionStations[activeSectionStationIndex] ?? null;
    const stationLang: StationLanguage = activeSectionStation?.language ?? 'zh-TW';
    const secondaryRailStep = sectionStations.length > 0 ? 100 / sectionStations.length : 100;
    const isBacklogPreviewOpen = activeFryPreviewPanel === 'backlog';
    const isFryingPreviewOpen = activeFryPreviewPanel === 'frying';
    const waterTaskStatusLabel = (status: WaterTaskStatus) => {
      switch (status) {
        case 'queued':
          return pt('pending', stationLang);
        case 'cooking':
          return pt('in_progress', stationLang);
        case 'done':
          return pt('completed', stationLang);
        default:
          return '';
      }
    };
    const waterTaskTypeLabel = (taskType: WaterTaskType) => {
      switch (taskType) {
        case 'dumpling':
          return pt('task_dumpling', stationLang);
        case 'noodle':
          return pt('task_noodle', stationLang);
        case 'side_heat':
          return pt('task_side_heat', stationLang);
        default:
          return '';
      }
    };
    const getWaterTiming = (task: WaterTask) => {
      const progress = getWaterTaskProgress(task.taskId);
      const elapsedSeconds = progress.startedAt
        ? Math.max(0, Math.floor((fryTimerNow - progress.startedAt) / 1000))
        : 0;
      const remainingSeconds = Math.max(0, task.durationSeconds - elapsedSeconds);
      const progressRatio = progress.startedAt
        ? Math.min(100, (elapsedSeconds / Math.max(1, task.durationSeconds)) * 100)
        : 0;
      const canFinish = progress.status === 'cooking' && remainingSeconds <= 0;
      return {
        progress,
        elapsedSeconds,
        remainingSeconds,
        progressRatio,
        canFinish,
      };
    };
    const isWaterBatchCaptured = waterCapturedDumplingTaskCount > 0;
    const waterBatchDisplayFlavorSummary = isWaterBatchCaptured
      ? waterCapturedDumplingFlavorSummary
      : waterEstimatedDumplingFlavorSummary;
    const waterBatchDisplayTotalCount = isWaterBatchCaptured
      ? waterCapturedDumplingCount
      : waterEstimatedDumplingBatch.totalCount;
    const groupWaterTasksByOrder = (tasks: WaterTask[]) => {
      const groups = new Map<string, {
        orderId: string;
        createdAt: number;
        serviceMode: ServiceMode;
        tasks: WaterTask[];
      }>();
      tasks.forEach((task) => {
        const existing = groups.get(task.orderId);
        if (existing) {
          existing.tasks.push(task);
          return;
        }
        groups.set(task.orderId, {
          orderId: task.orderId,
          createdAt: task.createdAt,
          serviceMode: task.serviceMode,
          tasks: [task],
        });
      });
      return Array.from(groups.values()).sort(
        (a, b) => a.createdAt - b.createdAt || a.orderId.localeCompare(b.orderId),
      );
    };
    const waterDumplingOrderGroups = groupWaterTasksByOrder(waterDumplingActiveTasks);
    const waterNoodleQueuedTasks = waterLadleActiveTasks.filter(
      (task) => getWaterTaskProgress(task.taskId).status === 'queued',
    );
    const waterNoodleOrderGroups = groupWaterTasksByOrder(waterNoodleQueuedTasks);
    const isDumplingSection = productionSection === 'dumpling';
    const waterPanelSectionKey = productionSection === 'noodle' ? 'noodle' : 'dumpling';
    const showWaterCompletedPanel = showWaterCompletedPanelBySection[waterPanelSectionKey];
    const waterSectionQueuedTasks = isDumplingSection
      ? waterQueuedTasks.filter((task) => task.type === 'dumpling')
      : waterQueuedTasks.filter((task) => task.requiresLadle);
    const waterSectionDoneTasks = isDumplingSection
      ? waterDoneTasks.filter((task) => task.type === 'dumpling')
      : waterDoneTasks.filter((task) => task.requiresLadle);
    const waterSectionQueuedOrderPreview: string[] = [];
    waterSectionQueuedTasks.forEach((task) => {
      if (!waterSectionQueuedOrderPreview.includes(task.orderId)) {
        waterSectionQueuedOrderPreview.push(task.orderId);
      }
    });
    const waterSectionCompletedByOrder = groupWaterTasksByOrder(waterSectionDoneTasks)
      .sort((a, b) => b.createdAt - a.createdAt || b.orderId.localeCompare(a.orderId));
    const waterSectionQueuedOrderCount = waterSectionQueuedOrderPreview.length;
    const waterSectionDoneOrderCount = waterSectionCompletedByOrder.length;
    const waterSectionQueuedPieceCount = waterSectionQueuedTasks.reduce((sum, task) => sum + task.quantity, 0);
    const waterSectionCookingTaskCount = waterCookingTasks.filter((task) =>
      isDumplingSection ? task.type === 'dumpling' : task.requiresLadle,
    ).length;
    const selectedWaterTransferTask = selectedWaterTransferTaskId
      ? waterTaskMap.get(selectedWaterTransferTaskId)
      : null;
    const selectedWaterTransferLabel =
      selectedWaterTransferTask && selectedWaterTransferTask.requiresLadle
        ? `${selectedWaterTransferTask.orderId} · ${selectedWaterTransferTask.title}`
        : null;

    return (
      <section className="space-y-5 sm:space-y-6">
        <section className={`${cardClass} bafang-enter space-y-4`}>
          {!workspaceFullscreen && (
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/85 p-1 shadow-sm">
              <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
                <div
                  className="h-full rounded-xl bg-gradient-to-r from-[#20365a] to-[#2d4770] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    width: `${productionTabStep}%`,
                    transform: `translateX(${productionTabIndex * 100}%)`,
                    willChange: 'transform',
                    backfaceVisibility: 'hidden',
                  }}
                />
              </div>
              <div
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, productionTabs.length)}, minmax(0, 1fr))` }}
              >
                {productionTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={`${railButtonBase} ${
                      productionSection === tab.id
                        ? 'text-white'
                        : 'text-slate-700'
                    } ${isProductionStationMode ? 'cursor-default' : ''}`}
                    onClick={() => {
                      if (isProductionStationMode) return;
                      setProductionSection(tab.id);
                    }}
                    disabled={isProductionStationMode}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!workspaceFullscreen && hasSecondaryStationRail && (
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/80 p-1 shadow-sm">
              <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
                <div
                  className="h-full rounded-xl bg-gradient-to-r from-[#5d7397]/80 to-[#7c8fad]/80 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    width: `${secondaryRailStep}%`,
                    transform: `translateX(${activeSectionStationIndex * 100}%)`,
                    willChange: 'transform',
                    backfaceVisibility: 'hidden',
                  }}
                />
              </div>
              <div
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, sectionStations.length)}, minmax(0, 1fr))` }}
              >
                {sectionStations.map((station, index) => (
                  <button
                    key={`production-module-station-${productionSection}-${station.id}`}
                    className={`${railButtonBase} ${
                      activeSectionStationIndex === index
                        ? 'text-slate-900'
                        : 'text-slate-600'
                    }`}
                    onClick={() => {
                      if (isProductionStationMode) return;
                      setActiveProductionStationIndexBySection((prev) => ({
                        ...prev,
                        [productionSection]: index,
                      }));
                    }}
                    disabled={isProductionStationMode}
                  >
                    {station.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeSectionStation && (
            <div className="flex items-center gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs font-semibold text-slate-700">
                {pt('current_station', stationLang)}：{activeSectionStation.name}{isProductionStationMode ? pt('locked_suffix', stationLang) : ''}
              </div>
              <div className="flex gap-1">
                {STATION_LANGUAGES.map((sl) => (
                  <button
                    key={sl.code}
                    type="button"
                    className={`rounded-lg border px-2 py-1 text-xs font-semibold transition-colors ${
                      stationLang === sl.code
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                    onClick={() => updateStationLanguage(activeSectionStation.id, sl.code)}
                  >
                    {sl.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {productionSection === 'griddle' && (
          <section className={`${cardClass} space-y-4`}>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 md:col-span-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">{pt('waiting_to_cook', stationLang)}</p>
                  <button
                    className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:border-amber-400 hover:bg-amber-100"
                    onClick={() => toggleFryPreviewPanel('backlog')}
                  >
                    {isBacklogPreviewOpen ? pt('collapse', stationLang) : pt('view', stationLang)}
                  </button>
                </div>
                <p className="mt-1 text-2xl font-semibold text-amber-900">{fryBacklogOrderCount}</p>
                <p className="text-[11px] font-medium text-amber-800">{ptf('n_pending_batches', stationLang, { n: fryBacklogCount })}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {fryBacklogPreview.slice(0, 4).map((order) => (
                    <span
                      key={`backlog-preview-${order.orderId}`}
                      className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                    >
                      {order.orderId}
                    </span>
                  ))}
                  {fryBacklogPreview.length > 4 && (
                    <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      +{fryBacklogPreview.length - 4}
                    </span>
                  )}
                  {fryBacklogPreview.length === 0 && (
                    <span className="text-[11px] font-medium text-amber-700">{pt('no_waiting_orders', stationLang)}</span>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 md:col-span-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">{pt('frying', stationLang)}</p>
                  <button
                    className="rounded-lg border border-sky-300 bg-white px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:border-sky-400 hover:bg-sky-100"
                    onClick={() => toggleFryPreviewPanel('frying')}
                  >
                    {isFryingPreviewOpen ? pt('collapse', stationLang) : pt('view', stationLang)}
                  </button>
                </div>
                <p className="mt-1 text-2xl font-semibold text-sky-900">{fryingOrderCount}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {fryingPreviewDetail.slice(0, 4).map((order) => (
                    <span
                      key={`frying-preview-${order.orderId}`}
                      className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-800"
                    >
                      {order.orderId}
                    </span>
                  ))}
                  {fryingPreviewDetail.length > 4 && (
                    <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                      +{fryingPreviewDetail.length - 4}
                    </span>
                  )}
                  {fryingPreviewDetail.length === 0 && (
                    <span className="text-[11px] font-medium text-sky-700">{pt('no_active_batches', stationLang)}</span>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 md:col-span-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">{pt('completed', stationLang)}</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-900">{friedPotstickerPieces}</p>
                <p className="text-[11px] font-medium text-emerald-800">{pt('total_potsticker_count', stationLang)}</p>
              </div>
            </div>

            <div className={`grid transition-[grid-template-rows,opacity,margin] duration-400 ease-out ${
              activeFryPreviewPanel
                ? 'grid-rows-[1fr] opacity-100'
                : 'grid-rows-[0fr] opacity-0'
            }`}>
              <div className="min-h-0 overflow-hidden">
                <section className={`rounded-2xl p-4 ${
                  activeFryPreviewPanel === 'frying'
                    ? 'border border-sky-200 bg-sky-50/70'
                    : 'border border-amber-200 bg-amber-50/70'
                }`}>
                  {activeFryPreviewPanel === 'backlog' && (
                    <div className="space-y-2">
                      {fryBacklogPreview.map((order) => {
                        const isSplit = splitOrderIdSet.has(order.orderId);
                        const canSplitByBox = (potstickerBoxCountByOrder.get(order.orderId) ?? 0) > 1;
                        const isLockedOrder = lockedFryOrderIdSet.has(order.orderId);
                        const isProcessedOrder = friedFryOrderIdSet.has(order.orderId);
                        const canSplit = !isSplit && canSplitByBox && !isLockedOrder && !isProcessedOrder;
                        const estimatedStations = Array.from(
                          new Set(
                            order.entries
                              .map((entry) => estimatedStationByEntryId.get(entry.entryId))
                              .filter((label): label is string => Boolean(label)),
                          ),
                        );

                        return (
                          <article
                            key={`backlog-order-${order.orderId}`}
                            className="rounded-xl border border-amber-200 bg-white px-3 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{order.orderId}</p>
                                <p className="text-[11px] font-medium text-slate-500">
                                  {serviceModeLabel(order.serviceMode)} · {orderTimeLabel(order.createdAt)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-amber-800">{ptf('n_pieces_suffix', stationLang, { n: order.totalPotstickers })}</p>
                                <p className="text-[11px] font-medium text-slate-500">
                                  {order.entries.length > 1 ? `${order.entries.length} ${pt('unit_batches', stationLang)}` : pt('one_batch', stationLang)}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {estimatedStations.length > 0 ? (
                                estimatedStations.map((label) => (
                                  <span
                                    key={`estimated-station-${order.orderId}-${label}`}
                                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stationAccentClass(label)}`}
                                  >
                                    {pt('estimated', stationLang)} {label}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[11px] font-medium text-slate-500">{pt('not_assigned_station', stationLang)}</span>
                              )}
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {order.entries.map((entry) => (
                                <div
                                  key={`backlog-entry-${order.orderId}-${entry.entryId}`}
                                  className="rounded-lg border border-amber-100 bg-amber-50/70 px-2.5 py-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-amber-900">{entry.entryLabel}</p>
                                    <div className="flex items-center gap-2">
                                      <p className="text-xs font-semibold text-amber-800">{ptf('n_pieces_suffix', stationLang, { n: entry.potstickerCount })}</p>
                                      {estimatedStationByEntryId.get(entry.entryId) && (
                                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                                          stationAccentClass(estimatedStationByEntryId.get(entry.entryId) ?? '')
                                        }`}>
                                          {estimatedStationByEntryId.get(entry.entryId)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <p className="mt-1 text-[11px] font-medium text-amber-800">
                                    {entry.flavorCounts.map((flavor) => ptf('flavor_count', stationLang, { name: flavor.name, count: flavor.count })).join(' · ')}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2 flex items-center justify-end">
                              <button
                                className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                                  canSplit
                                    ? 'border border-amber-300 bg-amber-100 text-amber-800 hover:border-amber-400 hover:bg-amber-200'
                                    : 'border border-slate-200 bg-slate-100 text-slate-400'
                                }`}
                                onClick={() => splitOrderByBox(order.orderId)}
                                disabled={!canSplit}
                              >
                                {isSplit ? pt('already_split', stationLang) : pt('split_order', stationLang)}
                              </button>
                            </div>
                          </article>
                        );
                      })}

                      {fryBacklogPreview.length === 0 && (
                        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-center text-sm font-medium text-amber-800">
                          {pt('no_waiting_orders', stationLang)}
                        </div>
                      )}
                    </div>
                  )}

                  {activeFryPreviewPanel === 'frying' && (
                    <div className="space-y-2">
                      {fryingPreviewDetail.map((order) => (
                        <article
                          key={`frying-order-${order.orderId}`}
                          className="rounded-xl border border-sky-200 bg-white px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{order.orderId}</p>
                              <p className="text-[11px] font-medium text-slate-500">
                                {serviceModeLabel(order.serviceMode)} · {orderTimeLabel(order.createdAt)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-sky-800">{ptf('n_pieces_suffix', stationLang, { n: order.totalPotstickers })}</p>
                              <p className="text-[11px] font-medium text-slate-500">
                                {order.entries.length > 1 ? `${order.entries.length} ${pt('unit_batches', stationLang)}` : pt('one_batch', stationLang)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {order.stationLabels.map((stationLabel) => (
                              <span
                                key={`frying-station-${order.orderId}-${stationLabel}`}
                                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stationAccentClass(stationLabel)}`}
                              >
                                {stationLabel}
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {order.entries.map((entry) => (
                              <div
                                key={`frying-entry-${order.orderId}-${entry.entryId}`}
                                className="rounded-lg border border-sky-100 bg-sky-50/60 px-2.5 py-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold text-sky-900">{entry.entryLabel}</p>
                                  <p className="text-xs font-semibold text-sky-800">{ptf('n_pieces_suffix', stationLang, { n: entry.potstickerCount })}</p>
                                </div>
                                <p className="mt-1 text-[11px] font-medium text-sky-800">
                                  {entry.flavorCounts.map((flavor) => ptf('flavor_count', stationLang, { name: flavor.name, count: flavor.count })).join(' · ')}
                                </p>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}

                      {fryingPreviewDetail.length === 0 && (
                        <div className="rounded-xl border border-dashed border-sky-300 bg-sky-50 px-3 py-4 text-center text-sm font-medium text-sky-800">
                          {pt('no_active_batches', stationLang)}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {FRY_STATION_ORDER.map((stationId) => {
                const station = fryStations[stationId];
                const recommendation = fryRecommendations[stationId];
                const isLocked = Boolean(station.lockedBatch);
                const displayOrders = isLocked ? station.lockedBatch?.orders ?? [] : recommendation.orders;
                const showDetails = showFryOrderDetails[station.id];
                const timerStartedAt = station.lockedBatch?.timerStartedAt ?? null;
                const isTimerStarted = Boolean(timerStartedAt);
                const totalPotstickers = isLocked
                  ? station.lockedBatch?.totalPotstickers ?? 0
                  : recommendation.totalPotstickers;
                const flavorMap = new Map<string, number>();
                displayOrders.forEach((entry) => {
                  entry.flavorCounts.forEach((flavor) => {
                    flavorMap.set(flavor.name, (flavorMap.get(flavor.name) ?? 0) + flavor.count);
                  });
                });
                const flavorSummary = Array.from(flavorMap.entries())
                  .map(([name, count]) => ({ name, count }))
                  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
                const loadPercentage = station.capacity > 0
                  ? Math.min(100, (totalPotstickers / station.capacity) * 100)
                  : 0;
                const previewDurationSeconds = displayOrders.length > 0
                  ? Math.max(
                    Math.max(1, Math.round(station.frySeconds) || FRY_BATCH_SECONDS),
                    ...displayOrders.map((entry) =>
                      Math.max(1, Math.round(entry.durationSeconds) || FRY_BATCH_SECONDS),
                    ),
                  )
                  : Math.max(1, Math.round(station.frySeconds) || FRY_BATCH_SECONDS);
                const fryDurationSeconds = isLocked
                  ? Math.max(1, station.lockedBatch?.durationSeconds ?? previewDurationSeconds)
                  : previewDurationSeconds;
                const elapsedSeconds = isTimerStarted && timerStartedAt
                  ? Math.floor((fryTimerNow - timerStartedAt) / 1000)
                  : 0;
                const remainingSeconds = isTimerStarted
                  ? Math.max(0, fryDurationSeconds - elapsedSeconds)
                  : fryDurationSeconds;
                const timerProgress = isTimerStarted
                  ? Math.min(100, (elapsedSeconds / fryDurationSeconds) * 100)
                  : 0;
                const canLockBatch = !isLocked && displayOrders.length > 0;
                const canDropBatch = isLocked && !isTimerStarted;
                const canLiftPot = isLocked && isTimerStarted && remainingSeconds <= 0;
                const liftProgress = isLocked && isTimerStarted ? timerProgress : 0;
                const liftButtonLabel = isLocked && isTimerStarted && remainingSeconds > 0
                  ? ptf('lift_pot_countdown', stationLang, { n: remainingSeconds })
                  : pt('lift_pot', stationLang);

                return (
                  <article key={station.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-3xl font-black tracking-[0.06em] text-slate-900">{station.label}</h3>
                    </div>
                      <div className="w-full max-w-[250px]">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                              {pt('single_load', stationLang)}
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={station.capacity}
                              onChange={(event) => updateFryStationCapacity(station.id, event.target.value)}
                              disabled={isLocked}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                              {pt('fry_duration', stationLang)}
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={station.frySeconds}
                              onChange={(event) => updateFryStationDuration(station.id, event.target.value)}
                              disabled={isLocked}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </div>
                        </div>
                        <button
                          className={`mt-2 w-full rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                            isLocked
                              ? 'border-slate-200 bg-slate-100 text-slate-400'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                          }`}
                          onClick={recomputeFryRecommendations}
                          disabled={isLocked}
                        >
                          {pt('recalculate', stationLang)}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>{pt('batch_flavor_stats', stationLang)}</span>
                        <span>{totalPotstickers} / {station.capacity} {pt('unit_pieces', stationLang)}</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-200">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isLocked ? 'bg-sky-500' : 'bg-amber-500'
                          }`}
                          style={{ width: `${loadPercentage}%` }}
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {flavorSummary.map((flavor) => (
                          <div
                            key={`${station.id}-${flavor.name}`}
                            className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900"
                          >
                            <p className="text-xs font-semibold">{flavor.name}</p>
                            <p className="mt-0.5 text-base font-bold leading-none">{ptf('n_pieces_suffix', stationLang, { n: flavor.count })}</p>
                          </div>
                        ))}
                        {flavorSummary.length === 0 && (
                          <p className="text-xs font-medium text-slate-500">{pt('no_flavor_data', stationLang)}</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <button
                        className={`${actionButtonBase} min-h-12 ${
                          canLockBatch
                            ? 'bg-[#1f3356] text-white hover:bg-[#2d4770]'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                        onClick={() => lockFryStationBatch(station.id)}
                        disabled={!canLockBatch}
                      >
                        {pt('lock', stationLang)}
                      </button>
                      <button
                        className={`${actionButtonBase} min-h-12 ${
                          canDropBatch
                            ? 'bg-sky-600 text-white hover:bg-sky-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                        onClick={() => startFryStationTimer(station.id)}
                        disabled={!canDropBatch}
                      >
                        {pt('drop_in_pan', stationLang)}
                      </button>
                      <button
                        className={`${actionButtonBase} relative min-h-12 overflow-hidden ${
                          canLiftPot
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                        onClick={() => completeFryStationBatch(station.id)}
                        disabled={!canLiftPot}
                      >
                        <span
                          className="pointer-events-none absolute inset-y-0 left-0 bg-emerald-500/75 transition-[width] duration-200 ease-linear"
                          style={{ width: `${liftProgress}%` }}
                        />
                        <span className="relative z-10">{liftButtonLabel}</span>
                      </button>
                    </div>

                    <div className="mt-4">
                      <button
                        className={`${actionButtonBase} w-full border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                        onClick={() => toggleFryOrderDetails(station.id)}
                      >
                        {showDetails ? pt('collapse_order_detail', stationLang) : pt('view_order_detail', stationLang)}
                      </button>

                      <div className={`grid transition-[grid-template-rows,opacity,margin] duration-400 ease-out ${
                        showDetails
                          ? 'mt-3 grid-rows-[1fr] opacity-100'
                          : 'grid-rows-[0fr] opacity-0'
                      }`}>
                        <div className="min-h-0 overflow-hidden">
                          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            {displayOrders.map((entry) => (
                              <div
                                key={`${station.id}-${entry.entryId}`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                              >
                                <div className="flex items-center justify-between text-sm">
                                  <p className="font-semibold text-slate-900">{entry.orderId} · {entry.entryLabel}</p>
                                  <p className="font-semibold text-amber-700">{ptf('total_n_pieces', stationLang, { n: entry.potstickerCount })}</p>
                                </div>
                                <p className="mt-0.5 text-xs font-medium text-slate-500">
                                  {serviceModeLabel(entry.serviceMode)} · {orderTimeLabel(entry.createdAt)}
                                </p>
                                <p className="mt-1 text-xs font-medium text-amber-700">
                                  {entry.flavorCounts.map((flavor) => ptf('flavor_count', stationLang, { name: flavor.name, count: flavor.count })).join(' · ')}
                                </p>
                              </div>
                            ))}

                            {displayOrders.length === 0 && (
                              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm font-medium text-slate-500">
                                {pt('no_cookable_batches', stationLang)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {!isLocked && recommendation.blockedOrder && displayOrders.length === 0 && (
                        <p className="mt-2 text-xs font-semibold text-rose-600">
                          {ptf('overload_warning', stationLang, { orderId: recommendation.blockedOrder.orderId, count: recommendation.blockedOrder.potstickerCount })}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {(productionSection === 'dumpling' || productionSection === 'noodle') && (
          <section className={`${cardClass} space-y-4`}>
            <div className="grid gap-3 md:grid-cols-12">
              <div
                className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 md:col-span-7"
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_240px] sm:gap-4">
                  <div className="sm:pr-4">
                    <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">{pt('pending', stationLang)}</p>
                    <p className="mt-1 text-4xl font-bold leading-none text-blue-900">{waterSectionQueuedOrderCount}</p>
                    <p className="mt-1 text-[11px] font-medium text-blue-800">{pt('n_orders', stationLang)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-blue-800">
                      <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5">
                        {isDumplingSection
                          ? ptf('queued_pieces', stationLang, { n: waterSectionQueuedPieceCount })
                          : ptf('queued_ladles', stationLang, { n: waterSectionQueuedTasks.length })}
                      </span>
                      <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5">
                        {isDumplingSection
                          ? ptf('pot_pieces', stationLang, { n: waterDumplingCookingPieces })
                          : ptf('cooking_n_tasks', stationLang, { n: waterSectionCookingTaskCount })}
                      </span>
                    </div>
                  </div>
                  <div className="sm:border-l sm:border-blue-200 sm:pl-4">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">{pt('order_number', stationLang)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {waterSectionQueuedOrderPreview.slice(0, 8).map((orderId) => (
                        <span
                          key={`water-queued-preview-${orderId}`}
                          className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-800"
                        >
                          {orderId}
                        </span>
                      ))}
                      {waterSectionQueuedOrderPreview.length > 8 && (
                        <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                          +{waterSectionQueuedOrderPreview.length - 8}
                        </span>
                      )}
                      {waterSectionQueuedOrderPreview.length === 0 && (
                        <span className="text-[11px] font-medium text-blue-700">{pt('no_pending_orders', stationLang)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div
                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 md:col-span-5"
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-4">
                  <div className="sm:pr-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">{pt('completed', stationLang)}</p>
                      <button
                        className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                          waterSectionDoneOrderCount > 0
                            ? 'border border-emerald-300 bg-white text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100'
                            : 'border border-slate-200 bg-slate-100 text-slate-400'
                        }`}
                        onClick={() =>
                          setShowWaterCompletedPanelBySection((prev) => ({
                            ...prev,
                            [waterPanelSectionKey]: !prev[waterPanelSectionKey],
                          }))
                        }
                        disabled={waterSectionDoneOrderCount === 0}
                      >
                        {showWaterCompletedPanel ? pt('collapse', stationLang) : pt('view', stationLang)}
                      </button>
                    </div>
                    <p className="mt-1 text-4xl font-bold leading-none text-emerald-900">{waterSectionDoneOrderCount}</p>
                    <p className="mt-1 text-[11px] font-medium text-emerald-800">{pt('n_orders', stationLang)}</p>
                  </div>
                  <div className="sm:border-l sm:border-emerald-200 sm:pl-4">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">{pt('order_number', stationLang)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {waterSectionCompletedByOrder.slice(0, 3).map((group) => (
                        <span
                          key={`water-done-preview-chip-${group.orderId}`}
                          className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                        >
                          {group.orderId}
                        </span>
                      ))}
                      {waterSectionCompletedByOrder.length > 3 && (
                        <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          +{waterSectionCompletedByOrder.length - 3}
                        </span>
                      )}
                      {waterSectionDoneOrderCount === 0 && (
                        <span className="text-[11px] font-medium text-emerald-700">{pt('no_completed_records', stationLang)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`grid transition-[grid-template-rows,opacity,margin] duration-400 ease-out ${
              showWaterCompletedPanel
                ? 'grid-rows-[1fr] opacity-100'
                : 'grid-rows-[0fr] opacity-0'
            }`}>
              <div className="min-h-0 overflow-hidden">
                <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <div className="space-y-2">
                    {waterSectionCompletedByOrder.slice(0, 8).map((group) => (
                      <article
                        key={`water-done-order-${group.orderId}`}
                        className={`rounded-xl border border-emerald-200 bg-white px-3 py-3 border-l-[6px] ${waterServiceModeStripeClass(group.serviceMode)}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${waterServiceModeBadgeClass(group.serviceMode)}`}>
                              {waterServiceModeLabel(group.serviceMode, stationLang)}
                            </span>
                            <p className="text-sm font-semibold text-slate-900">{group.orderId}</p>
                          </div>
                          <p className="text-xs font-semibold text-emerald-700">{ptf('completed_n_tasks', stationLang, { n: group.tasks.length })}</p>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {group.tasks.map((task) => (
                            <span
                              key={`water-done-task-chip-${task.taskId}`}
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                            >
                              {waterTaskTypeLabel(task.type)} · {task.title} {task.quantity}{task.unitLabel}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            {productionSection === 'dumpling' && (
              <div className="grid gap-4 md:grid-cols-12">
                <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 md:col-span-7">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-bold text-blue-900">{pt('dumpling_orders', stationLang)}</h3>
                    <p className="text-sm font-semibold text-blue-800">{ptf('n_sheets', stationLang, { n: waterDumplingOrderGroups.length })}</p>
                  </div>
                  <div className="mt-3 max-h-[56vh] space-y-3 overflow-y-auto pr-1 md:max-h-[72vh] xl:max-h-[760px] bafang-soft-scroll">
                    {waterDumplingOrderGroups.map((group) => (
                      <article
                        key={`water-dumpling-order-group-${group.orderId}`}
                        className={`rounded-xl border border-blue-200 bg-white px-3 py-3 border-l-[6px] ${waterServiceModeStripeClass(group.serviceMode)}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${waterServiceModeBadgeClass(group.serviceMode)}`}>
                              {waterServiceModeLabel(group.serviceMode, stationLang)}
                            </span>
                            <p className="text-sm font-semibold text-slate-900">{group.orderId}</p>
                          </div>
                          <p className="text-xs font-semibold text-blue-700">{ptf('n_tasks_suffix', stationLang, { n: group.tasks.length })}</p>
                        </div>
                        <div className="mt-2 space-y-2">
                          {group.tasks.map((task) => {
                            const timing = getWaterTiming(task);
                            const isQueued = timing.progress.status === 'queued';
                            const finishProgress = timing.progress.status === 'cooking' ? timing.progressRatio : 0;
                            const finishButtonLabel = timing.progress.status === 'cooking' && timing.remainingSeconds > 0
                              ? ptf('scoop_countdown', stationLang, { n: timing.remainingSeconds })
                              : pt('scoop_done', stationLang);
                            const showForceFinishConfirm =
                              waterForceFinishPromptTaskId === task.taskId &&
                              timing.progress.status === 'cooking' &&
                              !timing.canFinish;
                            return (
                              <div
                                key={`water-dumpling-order-task-${task.taskId}`}
                                className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                                    <p className="mt-0.5 text-xs font-medium text-blue-700">
                                      {task.flavorCounts.map((flavor) => ptf('flavor_count', stationLang, { name: flavor.name, count: flavor.count })).join(' · ')}
                                    </p>
                                  </div>
                                  <p className="text-sm font-semibold text-blue-900">{task.quantity}{task.unitLabel}</p>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <button
                                    className={`${actionButtonBase} min-h-10 ${
                                      isQueued
                                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                                        : 'bg-slate-200 text-slate-500'
                                    }`}
                                    onClick={() => startWaterTask(task.taskId)}
                                    disabled={!isQueued}
                                  >
                                    {pt('drop_in_pan', stationLang)}
                                  </button>
                                  <button
                                    className={`${actionButtonBase} relative min-h-10 overflow-hidden ${
                                      timing.canFinish
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                        : 'bg-slate-200 text-slate-500'
                                    }`}
                                    onClick={() => handleWaterFinishProgressTap(task.taskId, timing.canFinish)}
                                    disabled={timing.progress.status !== 'cooking'}
                                  >
                                    <span
                                      className="pointer-events-none absolute inset-y-0 left-0 bg-emerald-500/75 transition-[width] duration-200 ease-linear"
                                      style={{ width: `${finishProgress}%` }}
                                    />
                                    <span className="relative z-10">{finishButtonLabel}</span>
                                  </button>
                                </div>
                                <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                  showForceFinishConfirm
                                    ? 'mt-2 grid-rows-[1fr] opacity-100'
                                    : 'grid-rows-[0fr] opacity-0'
                                }`}>
                                  <div className="min-h-0 overflow-hidden">
                                    <button
                                      className={`${actionButtonBase} min-h-9 w-full border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100`}
                                      onClick={() => completeWaterTask(task.taskId, true)}
                                    >
                                      {pt('confirm_force_end', stationLang)}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                    {waterDumplingOrderGroups.length === 0 && (
                      <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 px-3 py-4 text-center text-sm font-medium text-blue-800">
                        {pt('no_dumpling_orders', stationLang)}
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 md:col-span-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-bold text-blue-900">{pt('dumpling_grabber', stationLang)}</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-center">
                        <p className="text-[11px] font-semibold text-blue-700">{pt('waiting_pot', stationLang)}</p>
                        <p className="text-xl font-bold text-blue-900">{waterDumplingQueuedPieces}</p>
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-center">
                        <p className="text-[11px] font-semibold text-sky-700">{pt('in_pot', stationLang)}</p>
                        <p className="text-xl font-bold text-sky-900">{waterDumplingCookingPieces}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-blue-900">{pt('batch_grab_target', stationLang)}</p>
                      <p className="text-2xl font-bold text-blue-900">
                        {waterDumplingTargetCount}
                        <span className="ml-1 text-sm font-semibold text-blue-700">{pt('unit_pieces', stationLang)}</span>
                      </p>
                    </div>
                    <div className="px-1">
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={10}
                        value={waterDumplingTargetCount}
                        onChange={(event) => setWaterDumplingTargetCount(Number(event.target.value))}
                        className="bafang-range h-8 w-full touch-none"
                      />
                      <div className="mt-1 flex items-center justify-between text-xs font-semibold text-blue-600">
                        <span>20</span>
                        <span>100</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={`${actionButtonBase} min-h-11 ${
                          waterEstimatedDumplingTaskCount > 0
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                        onClick={captureWaterDumplingBatch}
                        disabled={waterEstimatedDumplingTaskCount === 0}
                      >
                        {pt('grab_batch', stationLang)}
                      </button>
                      <button
                        className={`${actionButtonBase} min-h-11 ${
                          waterCapturedDumplingTaskCount > 0
                            ? 'bg-sky-600 text-white hover:bg-sky-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                        onClick={startCapturedWaterDumplingBatch}
                        disabled={waterCapturedDumplingTaskCount === 0}
                      >
                        {pt('cook_this_batch', stationLang)}
                      </button>
                    </div>

                    <div className={`rounded-xl border px-3 py-3 ${
                      isWaterBatchCaptured
                        ? 'border-sky-200 bg-sky-50/70'
                        : 'border-blue-200 bg-white'
                    }`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className={`text-sm font-semibold ${
                          isWaterBatchCaptured ? 'text-sky-800' : 'text-blue-800'
                        }`}>
                          {isWaterBatchCaptured ? pt('captured_batch', stationLang) : pt('estimated_batch', stationLang)}
                        </p>
                        <p className="text-lg font-bold text-slate-900">{ptf('n_pieces_suffix', stationLang, { n: waterBatchDisplayTotalCount })}</p>
                      </div>
                      {!isWaterBatchCaptured && waterEstimatedDumplingBatch.overflowFallback && (
                        <p className="mt-2 text-xs font-semibold text-amber-700">
                          {pt('overflow_fallback', stationLang)}
                        </p>
                      )}
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {waterBatchDisplayFlavorSummary.map((flavor) => (
                          <div
                            key={`water-dumpling-batch-flavor-${flavor.name}`}
                            className="rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-2"
                          >
                            <p className="text-xs font-semibold text-blue-800">{flavor.name}</p>
                            <p className="mt-0.5 text-lg font-bold leading-none text-blue-900">{ptf('n_pieces_suffix', stationLang, { n: flavor.count })}</p>
                          </div>
                        ))}
                        {waterBatchDisplayFlavorSummary.length === 0 && (
                          <p className="text-xs font-semibold text-blue-700">{pt('no_grabbable_batches', stationLang)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {productionSection === 'noodle' && (
              <div className="grid gap-4 md:grid-cols-12">
                <section className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 md:col-span-7 xl:sticky xl:top-4 xl:self-start">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-cyan-900">{pt('ladle', stationLang)}</h3>
                      <p className="text-xs font-medium text-cyan-700">
                        {pt('noodle_hint', stationLang)}
                      </p>
                    </div>
                    <div className="flex items-end gap-2">
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-widest text-cyan-700">
                          {pt('ladle_count', stationLang)}
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={waterLadleCapacity}
                          onChange={(event) => updateWaterLadleCapacity(event.target.value)}
                          className="mt-1 w-24 rounded-lg border border-cyan-300 bg-white px-2 py-1.5 text-sm font-semibold text-cyan-900"
                        />
                      </div>
                      <p className="pb-1 text-xs font-semibold text-cyan-700">
                        {ptf('used_idle', stationLang, { busy: waterLadleBusyCount, total: waterLadleCapacity, idle: waterLadleIdleCount })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-5">
                    <p className={`text-xs font-semibold text-cyan-800 transition-all duration-300 ${
                      selectedWaterTransferLabel ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
                    }`}>
                      {selectedWaterTransferLabel ? ptf('selected_label', stationLang, { label: selectedWaterTransferLabel }) : pt('selected_none', stationLang)}
                    </p>
                  </div>

                  <div className="mt-3 space-y-3">
                    {waterLadleSlots.map((slot) => {
                      const slotTask = waterCookingTaskByLadleSlot.get(slot) ?? null;
                      const slotTiming = slotTask ? getWaterTiming(slotTask) : null;
                      const slotFinishProgress = slotTiming?.progress.status === 'cooking' ? slotTiming.progressRatio : 0;
                      const slotFinishButtonLabel = slotTiming && slotTiming.progress.status === 'cooking' && slotTiming.remainingSeconds > 0
                        ? ptf('scoop_countdown', stationLang, { n: slotTiming.remainingSeconds })
                        : pt('scoop_done', stationLang);
                      const isSlotAssignReady = selectedWaterTransferTaskId
                        ? canAssignWaterTaskToLadleSlot(selectedWaterTransferTaskId, slot)
                        : false;
                      const isTransferFxSlot = waterTransferFx?.slot === slot;
                      const showTransferFx = isTransferFxSlot && waterTransferFx?.phase === 'show';
                      const slotTaskUnlocked = slotTask ? isWaterTaskUnlocked(slotTask.taskId) : false;
                      const isSlotTaskSelected = slotTask?.taskId === selectedWaterTransferTaskId;
                      return (
                        <div
                          key={`water-ladle-slot-${slot}`}
                          onClick={() => {
                            if (!isSlotAssignReady) return;
                            assignSelectedWaterTaskToLadle(slot);
                          }}
                          className={`relative rounded-2xl border px-4 py-3 transition-[background-color,border-color,box-shadow,transform] duration-300 ${
                            isSlotAssignReady
                              ? 'cursor-pointer border-cyan-400 bg-cyan-100/75 ring-2 ring-cyan-200/70'
                              : slotTask
                                ? 'border-cyan-300 bg-white'
                                : 'border-dashed border-slate-300 bg-slate-100/85 min-h-[92px]'
                          }`}
                        >
                          {showTransferFx && (
                            <div className="pointer-events-none absolute inset-0 bafang-slot-accept rounded-2xl" />
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-cyan-800">{ptf('ladle_n', stationLang, { n: slot })}</p>
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              slotTask
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-slate-300 bg-white text-slate-600'
                            }`}>
                              {slotTask ? pt('cooking', stationLang) : pt('standby', stationLang)}
                            </span>
                          </div>
                          {!slotTask && (
                            <p className="mt-3 text-sm font-medium text-cyan-700">
                              {isSlotAssignReady ? pt('tap_to_assign', stationLang) : pt('select_order_first', stationLang)}
                            </p>
                          )}
                          {slotTask && slotTiming && (
                            <div
                              className={`mt-3 rounded-xl border border-cyan-200 border-l-[6px] ${waterServiceModeStripeClass(slotTask.serviceMode)} bg-cyan-50/60 px-3 py-3 select-none transition-all duration-300 ${
                                isSlotTaskSelected ? 'bafang-transfer-selected ring-2 ring-cyan-300/70' : ''
                              }`}
                            >
                              <p className="text-sm font-semibold text-slate-900">{slotTask.orderId} · {slotTask.title}</p>
                              <p className="mt-1 text-[11px] font-medium text-cyan-800">
                                {slotTask.quantity}{slotTask.unitLabel}
                                {slotTask.note ? ` · ${ptf('note_prefix', stationLang, { note: slotTask.note })}` : ''}
                              </p>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <button
                                  className={`${actionButtonBase} min-h-9 ${
                                    slotTaskUnlocked
                                      ? 'bg-slate-700 text-white hover:bg-slate-800'
                                      : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                                  }`}
                                  onClick={() => toggleWaterTaskUnlock(slotTask.taskId)}
                                >
                                  {slotTaskUnlocked ? pt('lock', stationLang) : pt('unlock', stationLang)}
                                </button>
                                <button
                                  className={`${actionButtonBase} relative min-h-9 overflow-hidden ${
                                    slotTiming.canFinish
                                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                      : 'bg-slate-200 text-slate-500'
                                  }`}
                                  onClick={() => handleWaterFinishProgressTap(slotTask.taskId, slotTiming.canFinish)}
                                  disabled={slotTiming.progress.status !== 'cooking'}
                                >
                                  <span
                                    className="pointer-events-none absolute inset-y-0 left-0 bg-emerald-500/75 transition-[width] duration-200 ease-linear"
                                    style={{ width: `${slotFinishProgress}%` }}
                                  />
                                  <span className="relative z-10">{slotFinishButtonLabel}</span>
                                </button>
                              </div>
                              <div className="mt-2">
                                <button
                                  className={`${actionButtonBase} min-h-9 w-full ${
                                    slotTaskUnlocked
                                      ? isSlotTaskSelected
                                        ? 'border border-cyan-400 bg-cyan-200 text-cyan-900'
                                        : 'border border-cyan-300 bg-white text-cyan-800 hover:border-cyan-400 hover:bg-cyan-100'
                                      : 'bg-slate-200 text-slate-500'
                                  }`}
                                  onClick={() => toggleWaterTransferSelection(slotTask.taskId)}
                                  disabled={!slotTaskUnlocked}
                                >
                                  {isSlotTaskSelected ? pt('selected_tap_ladle', stationLang) : pt('select_reassign', stationLang)}
                                </button>
                              </div>
                              <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                slotTaskUnlocked
                                  ? 'mt-2 grid-rows-[1fr] opacity-100'
                                  : 'grid-rows-[0fr] opacity-0'
                              }`}>
                                <div className="min-h-0 overflow-hidden">
                                  <button
                                    className={`${actionButtonBase} min-h-9 w-full border border-cyan-200 bg-cyan-100/70 text-cyan-900 hover:border-cyan-300 hover:bg-cyan-200/70`}
                                    onClick={() => moveWaterTaskBackToQueue(slotTask.taskId)}
                                  >
                                    {pt('return_to_queue', stationLang)}
                                  </button>
                                </div>
                              </div>
                              <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                waterForceFinishPromptTaskId === slotTask.taskId && !slotTiming.canFinish
                                  ? 'mt-2 grid-rows-[1fr] opacity-100'
                                  : 'grid-rows-[0fr] opacity-0'
                              }`}>
                                <div className="min-h-0 overflow-hidden">
                                  <button
                                    className={`${actionButtonBase} min-h-9 w-full border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100`}
                                    onClick={() => completeWaterTask(slotTask.taskId, true)}
                                  >
                                    {pt('confirm_force_end', stationLang)}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 md:col-span-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-bold text-cyan-900">{pt('noodle_orders', stationLang)}</h3>
                    <p className="text-sm font-semibold text-cyan-800">{ptf('n_sheets', stationLang, { n: waterNoodleOrderGroups.length })}</p>
                  </div>
                  <div className="mt-3 max-h-[56vh] space-y-3 overflow-y-auto pr-1 md:max-h-[72vh] xl:max-h-[760px] bafang-soft-scroll">
                    {waterNoodleOrderGroups.map((group) => (
                      <article
                        key={`water-noodle-order-group-${group.orderId}`}
                        className={`rounded-xl border border-cyan-200 bg-white px-3 py-3 border-l-[6px] ${waterServiceModeStripeClass(group.serviceMode)}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${waterServiceModeBadgeClass(group.serviceMode)}`}>
                              {waterServiceModeLabel(group.serviceMode, stationLang)}
                            </span>
                            <p className="text-sm font-semibold text-slate-900">{group.orderId}</p>
                          </div>
                          <p className="text-xs font-semibold text-cyan-700">{ptf('n_tasks_suffix', stationLang, { n: group.tasks.length })}</p>
                        </div>
                        <div className="mt-2 space-y-2">
                          {group.tasks.map((task) => {
                            const timing = getWaterTiming(task);
                            const isSelected = selectedWaterTransferTaskId === task.taskId;
                            const canSelect = canSelectWaterTransferTask(task.taskId);
                            return (
                              <button
                                type="button"
                                key={`water-noodle-order-task-${task.taskId}`}
                                onClick={() => toggleWaterTransferSelection(task.taskId)}
                                disabled={!canSelect}
                                className={`w-full rounded-lg border px-3 py-2.5 text-left select-none transition-all duration-300 ${
                                  isSelected
                                    ? 'bafang-transfer-selected border-cyan-400 bg-cyan-100/80 ring-2 ring-cyan-200/80'
                                    : canSelect
                                      ? 'border-cyan-100 bg-cyan-50/70 hover:border-cyan-300 hover:bg-cyan-100/60'
                                      : 'border-slate-200 bg-slate-100 text-slate-500'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                                    {task.note && (
                                      <p className="mt-0.5 text-xs font-semibold text-cyan-800">{ptf('note_prefix', stationLang, { note: task.note })}</p>
                                    )}
                                    <p className="mt-0.5 text-xs font-medium text-cyan-700">
                                      {waterTaskStatusLabel(timing.progress.status)}
                                      {timing.progress.ladleSlot ? ` · ${ptf('ladle_n', stationLang, { n: timing.progress.ladleSlot })}` : ''}
                                    </p>
                                  </div>
                                  <p className="text-sm font-semibold text-cyan-900">{task.quantity}{task.unitLabel}</p>
                                </div>
                                <p className={`mt-2 text-xs font-semibold transition-all duration-300 ${
                                  isSelected ? 'text-cyan-900' : 'text-cyan-700'
                                }`}>
                                  {isSelected ? pt('selected_tap_ladle', stationLang) : pt('tap_to_select', stationLang)}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                    {waterNoodleOrderGroups.length === 0 && (
                      <div className="rounded-xl border border-dashed border-cyan-300 bg-cyan-50 px-3 py-4 text-center text-sm font-medium text-cyan-800">
                        {pt('no_noodle_orders', stationLang)}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

          </section>
        )}
      </section>
    );
  };

  const workflowDraftChanged = useMemo(
    () => JSON.stringify(workflowDraft) !== JSON.stringify(workflowSettings),
    [workflowDraft, workflowSettings],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (activePerspective !== 'settings' || !workflowDraftChanged) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [activePerspective, workflowDraftChanged]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setWorkspaceFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const showReviewAlertToast = (text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReviewAlertToast({ id, text, phase: 'show' });
  };

  const handleShellLogout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await authApi.logout();
    } finally {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  };

  const requestPerspectiveChange = (nextPerspective: AppPerspective) => {
    if (!canActivatePerspective(nextPerspective)) return;
    if (nextPerspective === activePerspective) return;
    if (
      activePerspective === 'settings' &&
      nextPerspective !== 'settings' &&
      workflowDraftChanged
    ) {
      setSettingsLeaveNotice({ stamp: Date.now(), phase: 'show' });
      return;
    }
    setActivePerspective(nextPerspective);
  };
  const refreshCommandHubQueues = () => {
    if (!isCommandHubMode || commandHubLoading) return;
    setCommandHubRefreshToken((prev) => prev + 1);
  };

  const renderSettingsWorkspace = () => {
    const sortedProductionOrders = [...productionOrders].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    const sortedPackagingOrders = [...packagingOrders]
      .filter((order) => getPackagingStatus(order.id) === 'waiting_pickup')
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const productionStationsForFlow = workflowDraft.productionStations.map((station) => ({
      ...station,
      module: resolveProductionModuleFromStation(station),
    }));
    const productionStationsByModuleForFlow = PRODUCTION_MODULES.map((module) => ({
      module,
      stations: productionStationsForFlow.filter((station) => station.module === module),
    }));
    const stationServiceModeLabel = (mode: WorkflowStation['serviceMode']) =>
      mode === 'any' ? '全部' : mode === 'dine_in' ? '內用' : '外帶';
    const stationMatchModeLabel = (mode: WorkflowMatchMode) => (mode === 'all' ? 'ALL' : 'ANY');
    const settingsNewItemInputTags = sanitizeTagArray(
      settingsNewMenuItem.tags
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    const settingsNewItemEffectiveTags = settingsNewItemInputTags.length > 0
      ? settingsNewItemInputTags
      : [CATEGORY_TAG_BY_MENU_CATEGORY[settingsNewMenuItem.category]];
    const settingsNewItemHidePrepSeconds = settingsNewItemEffectiveTags.includes(
      CATEGORY_TAG_BY_MENU_CATEGORY.potsticker,
    );
    const baseCategoryTagSet = new Set(Object.values(CATEGORY_TAG_BY_MENU_CATEGORY));
    const draftItemMap = new Map(workflowDraft.menuItems.map((item) => [item.id, item]));
    const draftItemNameCategoryMap = new Map<string, WorkflowMenuItem>();
    workflowDraft.menuItems.forEach((item) => {
      const key = `${item.category}:${item.name}`.toLowerCase();
      if (!draftItemNameCategoryMap.has(key)) {
        draftItemNameCategoryMap.set(key, item);
      }
    });
    const draftAvailabilityById = new Map<string, MenuAvailabilityState>();
    const resolveDraftAvailability = (itemId: string, stack: Set<string>): MenuAvailabilityState => {
      const cached = draftAvailabilityById.get(itemId);
      if (cached) return cached;
      const item = draftItemMap.get(itemId);
      if (!item) {
        return {
          directSoldOut: true,
          dependencySoldOut: true,
          unavailable: true,
          blockingDependencyIds: [],
        };
      }
      if (stack.has(itemId)) {
        const cycleState: MenuAvailabilityState = {
          directSoldOut: item.soldOut,
          dependencySoldOut: true,
          unavailable: true,
          blockingDependencyIds: [...item.dependencyItemIds],
        };
        draftAvailabilityById.set(itemId, cycleState);
        return cycleState;
      }

      stack.add(itemId);
      const blockingDependencyIds: string[] = [];
      item.dependencyItemIds.forEach((dependencyId) => {
        const dependencyItem = draftItemMap.get(dependencyId);
        if (!dependencyItem) {
          blockingDependencyIds.push(dependencyId);
          return;
        }
        const dependencyState = resolveDraftAvailability(dependencyId, stack);
        if (dependencyState.unavailable) {
          blockingDependencyIds.push(dependencyId);
        }
      });
      stack.delete(itemId);

      const dependencySoldOut = blockingDependencyIds.length > 0;
      const state: MenuAvailabilityState = {
        directSoldOut: item.soldOut,
        dependencySoldOut,
        unavailable: item.soldOut || dependencySoldOut,
        blockingDependencyIds,
      };
      draftAvailabilityById.set(itemId, state);
      return state;
    };
    workflowDraft.menuItems.forEach((item) => {
      resolveDraftAvailability(item.id, new Set<string>());
    });
    const hasDraftSellableDumplingFlavor = workflowDraft.menuItems.some((item) => {
      if (item.category !== 'dumpling' || item.unit !== '顆') return false;
      return !(draftAvailabilityById.get(item.id)?.unavailable ?? true);
    });
    workflowDraft.menuItems.forEach((item) => {
      if (item.category !== 'soup_dumpling' || item.optionType !== 'soup_dumpling_flavor') return;
      const state = draftAvailabilityById.get(item.id);
      if (!state) return;
      if (hasDraftSellableDumplingFlavor) return;
      draftAvailabilityById.set(item.id, {
        ...state,
        dependencySoldOut: true,
        unavailable: true,
      });
    });
    const menuTagTabs = ['all', ...workflowDraft.menuTags];
    const activeMenuTag = settingsMenuActiveTag !== 'all' && workflowDraft.menuTags.includes(settingsMenuActiveTag)
      ? settingsMenuActiveTag
      : 'all';
    const sortedDraftMenuItems = [...workflowDraft.menuItems].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    const visibleDraftMenuItems = activeMenuTag === 'all'
      ? sortedDraftMenuItems
      : sortedDraftMenuItems.filter((item) => item.tags.includes(activeMenuTag));
    const menuItemCountByTag = new Map<string, number>();
    workflowDraft.menuTags.forEach((tag) => {
      menuItemCountByTag.set(
        tag,
        workflowDraft.menuItems.reduce((sum, item) => sum + (item.tags.includes(tag) ? 1 : 0), 0),
      );
    });
    const tagUsageCount = new Map<string, number>();
    workflowDraft.menuTags.forEach((tag) => {
      const usedByItems = workflowDraft.menuItems.reduce(
        (sum, item) => sum + (item.tags.includes(tag) ? 1 : 0),
        0,
      );
      const usedByStations = [...workflowDraft.productionStations, ...workflowDraft.packagingStations].reduce(
        (sum, station) => sum + station.tagRules.filter((rule) => rule.tag === tag).length,
        0,
      );
      tagUsageCount.set(tag, usedByItems + usedByStations);
    });

    const getStationMatchedOrders = (station: WorkflowStation, sourceOrders: SubmittedOrder[]) =>
      sourceOrders.filter((order) =>
        filterMatchesOrder(
          station,
          buildOrderCategoryFlags(order, draftItemMap),
          buildOrderTagSet(order, draftItemMap, draftItemNameCategoryMap),
          order.serviceMode,
        ),
      );

    const renderMaskedRail = (
      options: Array<{ id: string; label: string }>,
      value: string,
      onChange: (id: string) => void,
      buttonClass = 'min-h-9 text-xs',
    ) => {
      if (options.length === 0) return null;
      const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.id === value),
      );
      const step = 100 / options.length;
      return (
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100/85 p-1 shadow-sm">
          <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
            <div
              className="h-full rounded-lg bg-gradient-to-r from-slate-300/85 to-slate-200/90 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: `${step}%`,
                transform: `translateX(${selectedIndex * 100}%)`,
              }}
            />
          </div>
          <div
            className="relative grid"
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
          >
            {options.map((option) => (
              <button
                key={`rail-option-${option.id}`}
                type="button"
                className={`${railButtonBase} ${buttonClass} ${value === option.id ? 'text-slate-900' : 'text-slate-600'}`}
                onClick={() => onChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    };

    const renderStationCard = (
      scope: 'production' | 'packaging',
      station: WorkflowStation,
      index: number,
      total: number,
      sourceOrders: SubmittedOrder[],
    ) => {
      const matchedOrders = getStationMatchedOrders(station, sourceOrders);
      const accent = WORKFLOW_STATION_BADGE_ACCENTS[index % WORKFLOW_STATION_BADGE_ACCENTS.length];
      const stationModule = scope === 'production'
        ? resolveProductionModuleFromStation(station)
        : 'packaging';
      const stationHighlightActive = (
        settingsStationHighlight?.scope === scope &&
        settingsStationHighlight.stationId === station.id
      );
      const stationKey = `${scope}:${station.id}`;
      const isStationExpanded = settingsExpandedStationKeys.includes(stationKey);
      return (
        <article
          key={`${scope}-station-${station.id}`}
          ref={(node) => {
            settingsStationCardRef.current[`${scope}:${station.id}`] = node;
          }}
          className={`rounded-2xl border border-slate-200 bg-white p-4 transition-[box-shadow,border-color,transform] duration-500 ${
            stationHighlightActive
              ? settingsStationHighlight?.phase === 'show'
                ? 'border-amber-300 ring-2 ring-amber-200 shadow-lg shadow-amber-200/60 -translate-y-0.5'
                : 'border-amber-200 ring-1 ring-amber-100'
              : ''
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-[11px] font-semibold ${accent}`}>
                {index + 1}
              </span>
              <input
                type="text"
                value={station.name}
                onChange={(event) =>
                  updateDraftStation(scope, station.id, (prev) => ({
                    ...prev,
                    name: event.target.value.slice(0, 20),
                  }))
                }
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-600">
                命中 {matchedOrders.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSettingsExpandedStationKeys((prev) =>
                    prev.includes(stationKey)
                      ? prev.filter((key) => key !== stationKey)
                      : [...prev, stationKey],
                  )
                }
                className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
              >
                {isStationExpanded ? '收合' : '展開'}
              </button>
              <button
                type="button"
                onClick={() => moveDraftStation(scope, station.id, -1)}
                disabled={index === 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 disabled:opacity-35"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveDraftStation(scope, station.id, 1)}
                disabled={index === total - 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 disabled:opacity-35"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeDraftStation(scope, station.id)}
                disabled={total <= 1}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2 text-xs font-semibold text-rose-700 disabled:opacity-35"
              >
                刪除
              </button>
            </div>
          </div>

          <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
            isStationExpanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}>
            <div className="min-h-0 overflow-hidden">
              <div className="space-y-3 pt-0.5">
            {scope === 'production' && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">工作模組</p>
                <div className="mt-2">
                  {renderMaskedRail(
                    PRODUCTION_MODULES.map((module) => ({
                      id: module,
                      label: PRODUCTION_MODULE_LABEL[module],
                    })),
                    stationModule,
                    (nextModule) => setDraftProductionStationModule(station.id, nextModule as ProductionSection),
                  )}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">啟用</p>
                  <div className="mt-1.5">
                    {renderMaskedRail(
                      [
                        { id: 'enabled', label: '啟用' },
                        { id: 'disabled', label: '停用' },
                      ],
                      station.enabled ? 'enabled' : 'disabled',
                      (nextState) =>
                        updateDraftStation(scope, station.id, (prev) => ({
                          ...prev,
                          enabled: nextState === 'enabled',
                        })),
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">用餐方式</p>
                  <div className="mt-1.5">
                    {renderMaskedRail(
                      [
                        { id: 'any', label: '全部' },
                        { id: 'dine_in', label: '內用' },
                        { id: 'takeout', label: '外帶' },
                      ],
                      station.serviceMode,
                      (nextMode) =>
                        updateDraftStation(scope, station.id, (prev) => ({
                          ...prev,
                          serviceMode: nextMode as WorkflowStation['serviceMode'],
                        })),
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">邏輯</p>
                  <div className="mt-1.5">
                    {renderMaskedRail(
                      [
                        { id: 'any', label: '任一命中' },
                        { id: 'all', label: '全部命中' },
                      ],
                      station.matchMode,
                      (nextMode) =>
                        updateDraftStation(scope, station.id, (prev) => ({
                          ...prev,
                          matchMode: nextMode as WorkflowMatchMode,
                        })),
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">分類條件</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {WORKFLOW_MENU_CATEGORIES.map((category) => (
                  <div
                    key={`${scope}-${station.id}-${category}`}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2"
                  >
                    <p className="text-xs font-semibold text-slate-700">{getCategoryTag(category)}</p>
                    <div className="mt-1.5">
                      {renderMaskedRail(
                        [
                          { id: 'any', label: '不限' },
                          { id: 'yes', label: '需要' },
                          { id: 'no', label: '排除' },
                        ],
                        station.categoryRules[category],
                        (nextMode) =>
                          setDraftStationCategoryRule(
                            scope,
                            station.id,
                            category,
                            nextMode as RoutingMatchMode,
                          ),
                        'min-h-8 text-[11px]',
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">標籤條件</p>
                <button
                  type="button"
                  onClick={() => addDraftStationTagRule(scope, station.id, workflowDraft.menuTags[0])}
                  disabled={workflowDraft.menuTags.length === 0}
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 disabled:opacity-40"
                >
                  新增條件
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {station.tagRules.map((rule) => {
                  const tagOptions = workflowDraft.menuTags.includes(rule.tag)
                    ? workflowDraft.menuTags
                    : [rule.tag, ...workflowDraft.menuTags];
                  return (
                    <div key={`${scope}-${station.id}-${rule.id}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-slate-600">條件標籤</p>
                        <button
                          type="button"
                          onClick={() => removeDraftStationTagRule(scope, station.id, rule.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-700"
                        >
                          ×
                        </button>
                      </div>
                      <div className="mt-1.5 overflow-x-auto pb-1 bafang-soft-scroll">
                        <div className="flex min-w-max gap-1.5">
                          {tagOptions.map((tag) => (
                            <button
                              key={`${scope}-${station.id}-${rule.id}-tag-chip-${tag}`}
                              type="button"
                              onClick={() =>
                                updateDraftStationTagRule(scope, station.id, rule.id, (prev) => ({
                                  ...prev,
                                  tag,
                                }))
                              }
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                                rule.tag === tag
                                  ? 'border-amber-400 bg-amber-50 text-amber-900'
                                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                              }`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-1.5">
                        {renderMaskedRail(
                          [
                            { id: 'yes', label: '需要' },
                            { id: 'no', label: '排除' },
                          ],
                          rule.mode,
                          (nextMode) =>
                            updateDraftStationTagRule(scope, station.id, rule.id, (prev) => ({
                              ...prev,
                              mode: nextMode as RoutingMatchMode,
                            })),
                          'min-h-8 text-[11px]',
                        )}
                      </div>
                    </div>
                  );
                })}
                {station.tagRules.length === 0 && (
                  <p className="text-[11px] font-medium text-slate-500">目前未設定標籤條件</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs font-semibold text-slate-800">
                目前命中訂單 {matchedOrders.length} 張
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {matchedOrders.slice(0, 5).map((order) => (
                  <span
                    key={`${scope}-${station.id}-preview-${order.id}`}
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${accent}`}
                  >
                    {order.id}
                  </span>
                ))}
                {matchedOrders.length > 5 && (
                  <span className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    +{matchedOrders.length - 5}
                  </span>
                )}
                {matchedOrders.length === 0 && (
                  <span className="text-[11px] font-medium text-slate-500">目前無符合訂單</span>
                )}
              </div>
            </div>
              </div>
            </div>
          </div>
        </article>
      );
    };

    const settingsPanelTabs: Array<{ id: SettingsPanel; label: string }> = [
      { id: 'stations', label: '工作站' },
      { id: 'menu', label: '菜單' },
      ...(featureFlags.apiHub ? [{ id: 'apiHub' as SettingsPanel, label: 'API 庫' }] : []),
    ];
    const settingsPanelIndex = Math.max(
      0,
      settingsPanelTabs.findIndex((tab) => tab.id === settingsPanel),
    );
    const settingsPanelStep = 100 / settingsPanelTabs.length;

    const renderDraftMenuItemCard = (item: WorkflowMenuItem) => {
      const availability = draftAvailabilityById.get(item.id) ?? {
        directSoldOut: true,
        dependencySoldOut: true,
        unavailable: true,
        blockingDependencyIds: [],
      };
      const blockingDependencyNames = availability.blockingDependencyIds
        .map((dependencyId) => workflowDraft.menuItems.find((candidate) => candidate.id === dependencyId)?.name)
        .filter((name): name is string => Boolean(name));
      const backendReason = availability.unavailable
        ? availability.directSoldOut
          ? '手動售完'
          : `相依售完${blockingDependencyNames.length > 0
            ? `（${blockingDependencyNames.slice(0, 2).join('、')}${blockingDependencyNames.length > 2 ? ` 等${blockingDependencyNames.length}項` : ''}）`
            : ''}`
        : '可供應';
      const addableTags = workflowDraft.menuTags.filter((tag) => !item.tags.includes(tag));
      const dependencyCandidates = [...workflowDraft.menuItems]
        .filter((candidate) => candidate.id !== item.id)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const allowedPrepStations = getAllowedPrepStationsForCategory(item.category);
      const hidePrepSecondsInput = item.tags.includes(CATEGORY_TAG_BY_MENU_CATEGORY.potsticker);
      const isExpanded = settingsMenuExpandedItemId === item.id;

      return (
        <article key={`draft-menu-item-${item.id}`} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() =>
              setSettingsMenuExpandedItemId((prev) => (prev === item.id ? null : item.id))
            }
            className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
          >
            <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
            <div className="flex items-center gap-2">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                availability.unavailable
                  ? availability.directSoldOut
                    ? 'border-rose-300 bg-rose-50 text-rose-700'
                    : 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700'
              }`}>
                {availability.unavailable
                  ? '售完'
                  : '供應中'}
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                {isExpanded ? '收合' : '展開'}
              </span>
            </div>
          </button>

          <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}>
            <div className="min-h-0 overflow-hidden border-t border-slate-200">
              <div className="flex aspect-[10/16] min-h-[360px] flex-col p-3">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(event) =>
                        updateDraftMenuItem(item.id, (prev) => ({ ...prev, name: event.target.value.slice(0, 40) }))
                      }
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 focus:border-amber-400 focus:outline-none"
                    />
                    <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{item.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDraftMenuItem(item.id)}
                    disabled={!item.custom}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2 text-[11px] font-semibold text-rose-700 disabled:opacity-35"
                  >
                    刪除
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto pr-1 bafang-soft-scroll">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={item.price}
                      onChange={(event) =>
                        updateDraftMenuItem(item.id, (prev) => ({
                          ...prev,
                          price: Math.max(0, Number(event.target.value) || 0),
                        }))
                      }
                      className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 focus:border-amber-400 focus:outline-none"
                    />
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-1">
                      <div className="grid grid-cols-4 gap-1">
                        {(['顆', '份', '碗', '杯'] as const).map((unit) => (
                          <button
                            key={`item-unit-chip-${item.id}-${unit}`}
                            type="button"
                            onClick={() =>
                              updateDraftMenuItem(item.id, (prev) => ({
                                ...prev,
                                unit,
                              }))
                            }
                            className={`rounded-md px-1 py-1 text-[11px] font-semibold transition ${
                              item.unit === unit
                                ? 'bg-amber-200 text-amber-900'
                                : 'bg-white text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {unit}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">分類</p>
                    <div className="flex flex-wrap gap-1.5">
                      {WORKFLOW_MENU_CATEGORIES.map((category) => (
                        <button
                          key={`item-category-chip-${item.id}-${category}`}
                          type="button"
                          onClick={() => updateDraftMenuItemCategory(item.id, category)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                            item.category === category
                              ? 'border-amber-400 bg-amber-50 text-amber-900'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                          }`}
                        >
                          {getCategoryTag(category)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">加選類型</p>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { id: 'none', label: '無加選' },
                        { id: 'tofu_sauce', label: '豆腐口味' },
                        { id: 'noodle_staple', label: '麵條/冬粉' },
                        { id: 'soup_dumpling_flavor', label: '湯餃改口味' },
                      ] as Array<{ id: MenuOptionType; label: string }>).map((option) => (
                        <button
                          key={`item-option-chip-${item.id}-${option.id}`}
                          type="button"
                          onClick={() => updateDraftMenuItemOptionType(item.id, option.id)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                            item.optionType === option.id
                              ? 'border-amber-400 bg-amber-50 text-amber-900'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">工作站 / 備餐耗時</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allowedPrepStations.map((prepStation) => (
                        <button
                          key={`item-prep-station-chip-${item.id}-${prepStation}`}
                          type="button"
                          onClick={() => updateDraftMenuItemPrepStation(item.id, prepStation)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                            item.prepStation === prepStation
                              ? 'border-amber-400 bg-amber-50 text-amber-900'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                          }`}
                        >
                          {PREP_STATION_LABEL[prepStation]}
                        </button>
                      ))}
                    </div>
                    {!hidePrepSecondsInput && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-500">耗時</span>
                        <input
                          type="number"
                          min={item.prepStation === 'none' ? 0 : 1}
                          step={1}
                          value={item.prepSeconds}
                          disabled={item.prepStation === 'none'}
                          onChange={(event) => updateDraftMenuItemPrepSeconds(item.id, event.target.value)}
                          className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-amber-400 focus:outline-none"
                        />
                        <span className="text-[11px] font-semibold text-slate-500">秒</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">標籤</p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <button
                          key={`item-tag-${item.id}-${tag}`}
                          type="button"
                          onClick={() => removeDraftTagFromMenuItem(item.id, tag)}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                        >
                          <span>{tag}</span>
                          <span>×</span>
                        </button>
                      ))}
                    </div>
                    {addableTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {addableTags.map((tag) => (
                          <button
                            key={`item-tag-add-${item.id}-${tag}`}
                            type="button"
                            onClick={() => addDraftTagToMenuItem(item.id, tag)}
                            className="rounded-full border border-dashed border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
                          >
                            + {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">相依（ALL）</p>
                      <span className="text-[11px] font-semibold text-slate-500">{item.dependencyItemIds.length} 項</span>
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white bafang-soft-scroll">
                      {dependencyCandidates.map((candidate) => {
                        const linked = item.dependencyItemIds.includes(candidate.id);
                        const dependencyUnavailable = draftAvailabilityById.get(candidate.id)?.unavailable ?? true;
                        return (
                          <button
                            key={`item-dependency-list-${item.id}-${candidate.id}`}
                            type="button"
                            onClick={() => {
                              if (linked) {
                                removeDraftDependencyFromMenuItem(item.id, candidate.id);
                                return;
                              }
                              addDraftDependencyToMenuItem(item.id, candidate.id);
                            }}
                            className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5 text-left last:border-b-0 ${
                              linked ? 'bg-amber-50' : 'bg-white hover:bg-slate-50'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-semibold text-slate-800">{candidate.name}</p>
                              <p className="text-[10px] font-medium text-slate-500">
                                {getCategoryTag(candidate.category)}
                                {dependencyUnavailable ? ' · 目前不可供應' : ''}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              linked
                                ? 'border-amber-300 bg-amber-100 text-amber-800'
                                : 'border-slate-300 bg-white text-slate-500'
                            }`}>
                              {linked ? '已相依' : '加入'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[11px] font-semibold ${
                      availability.unavailable
                        ? availability.directSoldOut
                          ? 'text-rose-700'
                          : 'text-amber-700'
                        : 'text-emerald-700'
                    }`}>
                      {availability.unavailable
                        ? '點餐端：售完'
                        : '點餐端：供應中'}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        updateDraftMenuItem(item.id, (prev) => ({ ...prev, soldOut: !prev.soldOut }))
                      }
                      className={`inline-flex h-8 items-center justify-center rounded-lg px-2 text-[11px] font-semibold ${
                        item.soldOut
                          ? 'border border-rose-300 bg-rose-50 text-rose-700'
                          : 'border border-emerald-300 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {item.soldOut ? '手動售完' : '供應中'}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] font-medium text-slate-500">後端原因：{backendReason}</p>
                </div>
              </div>
            </div>
          </div>
        </article>
      );
    };

    return (
      <section className="space-y-5 sm:space-y-6">
        <section className={`${cardClass} bafang-enter`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              {!workspaceFullscreen && (
                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/80 p-1 shadow-sm">
                  <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
                    <div
                      className="h-full rounded-xl bg-gradient-to-r from-slate-300/85 to-slate-200/90 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{
                        width: `${settingsPanelStep}%`,
                        transform: `translateX(${settingsPanelIndex * 100}%)`,
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                      }}
                    />
                  </div>
                  <div className={`pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-slate-100/85 via-slate-100/50 to-transparent transition-[opacity,transform] duration-500 ease-out ${
                    settingsPanelIndex === 0 ? 'opacity-0 -translate-x-1' : 'opacity-100 translate-x-0'
                  }`} />
                  <div className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-100/85 via-slate-100/50 to-transparent transition-[opacity,transform] duration-500 ease-out ${
                    settingsPanelIndex === settingsPanelTabs.length - 1 ? 'opacity-0 translate-x-1' : 'opacity-100 translate-x-0'
                  }`} />
                  <div className={`relative grid ${settingsPanelTabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    {settingsPanelTabs.map((tab) => (
                      <button
                        key={`settings-panel-${tab.id}`}
                        type="button"
                        className={`${railButtonBase} ${settingsPanel === tab.id ? 'text-slate-900' : 'text-slate-600'}`}
                        onClick={() => setSettingsPanel(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
              <button
                type="button"
                onClick={saveWorkflowSettings}
                disabled={!workflowDraftChanged}
                className={`${actionButtonBase} min-h-10 bg-[#1f3356] px-4 text-white hover:bg-[#2d4770]`}
              >
                儲存
              </button>
              <button
                type="button"
                onClick={resetWorkflowDraft}
                disabled={!workflowDraftChanged}
                className={`${actionButtonBase} min-h-10 border border-slate-300 bg-white px-4 text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
              >
                取消變更
              </button>
            </div>
          </div>
        </section>

        {settingsPanel === 'stations' && (
          <section className="space-y-4">
            <section className={`${cardClass} bafang-enter`}>
              <div className="relative overflow-hidden rounded-3xl border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-4 py-5 text-slate-100 sm:px-6 sm:py-6">
                <div className="pointer-events-none absolute -left-10 top-[-72px] h-44 w-44 rounded-full bg-cyan-400/25 blur-3xl" />
                <div className="pointer-events-none absolute -right-12 bottom-[-88px] h-52 w-52 rounded-full bg-amber-300/25 blur-3xl" />
                <div className="pointer-events-none absolute left-1/2 top-[-62px] h-32 w-32 -translate-x-1/2 rounded-full bg-amber-300/20 blur-2xl" />

                <div className="relative">
                  <div className="flex justify-center">
                    <div className="inline-flex items-center rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-[0.12em] text-slate-100">
                      ORDER WORKFLOW
                    </div>
                  </div>
                  <h3 className="mt-3 text-center text-xl font-semibold text-white sm:text-2xl">訂單工作流程圖</h3>

                  <div className="mt-5 overflow-x-auto pb-1 bafang-soft-scroll">
                    <div className="mx-auto min-w-[860px] max-w-[1480px] px-2 py-2 sm:min-w-[980px]">
                      <div className="grid grid-cols-[170px_72px_minmax(300px,1fr)_72px_minmax(300px,1fr)_72px_170px] items-center gap-3 lg:gap-4">
                        <div>
                          <div className="rounded-2xl border border-cyan-200/45 bg-cyan-400/15 px-3 py-3 text-center backdrop-blur-sm">
                            <p className="text-xs font-semibold tracking-[0.08em] text-cyan-100">STEP 01</p>
                            <p className="mt-1 text-sm font-semibold text-white">訂單進站</p>
                          </div>
                        </div>

                        <div className="flex items-center px-1">
                          <div className="h-px w-full bg-cyan-200/60" />
                        </div>

                        <article className="relative rounded-2xl border border-cyan-300/35 bg-cyan-400/10 p-3 backdrop-blur-sm">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold tracking-[0.08em] text-cyan-100">製作端工作站</h4>
                            <span className="rounded-full border border-cyan-200/40 bg-cyan-100/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
                              {workflowDraft.productionStations.filter((station) => station.enabled).length} 啟用
                            </span>
                          </div>
                          <div className="pointer-events-none absolute bottom-4 left-2 top-14 w-px bg-cyan-100/35" />
                          <div className="mt-3 space-y-2.5">
                            {productionStationsByModuleForFlow.map((group) => (
                              <div key={`flow-module-${group.module}`}>
                                <div className="rounded-xl border border-white/15 bg-slate-900/45 px-2.5 py-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-slate-100">{PRODUCTION_MODULE_LABEL[group.module]}</p>
                                    <span className="text-[11px] font-medium text-slate-300">{group.stations.length} 站</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {group.stations.map((station) => (
                                      <div
                                        key={`flow-station-production-${station.id}`}
                                        className={`rounded-lg border px-2 py-1.5 ${
                                          station.enabled
                                            ? 'border-emerald-300/45 bg-emerald-300/15'
                                            : 'border-slate-400/40 bg-slate-600/20'
                                        }`}
                                      >
                                        <p className={`text-[11px] font-semibold ${
                                          station.enabled ? 'text-emerald-100' : 'text-slate-300'
                                        }`}>
                                          {station.name}
                                        </p>
                                        <div className="mt-1 flex items-center gap-1">
                                          <span className="rounded-full border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-100">
                                            {stationServiceModeLabel(station.serviceMode)}
                                          </span>
                                          <span className="rounded-full border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-100">
                                            {stationMatchModeLabel(station.matchMode)}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                    {group.stations.length === 0 && (
                                      <span className="rounded-lg border border-dashed border-white/25 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-300">
                                        尚未新增工作站
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>

                        <div className="flex items-center px-1">
                          <div className="h-px w-full bg-amber-200/60" />
                        </div>

                        <article className="relative rounded-2xl border border-amber-300/35 bg-amber-300/10 p-3 backdrop-blur-sm">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold tracking-[0.08em] text-amber-100">包裝端工作站</h4>
                            <span className="rounded-full border border-amber-200/40 bg-amber-100/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                              {workflowDraft.packagingStations.filter((station) => station.enabled).length} 啟用
                            </span>
                          </div>
                          <div className="pointer-events-none absolute bottom-4 left-2 top-14 w-px bg-amber-100/35" />
                          <div className="mt-3 space-y-2">
                            {workflowDraft.packagingStations.map((station) => (
                              <div key={`flow-packaging-row-${station.id}`}>
                                <div
                                  key={`flow-station-packaging-${station.id}`}
                                  className={`rounded-xl border px-2.5 py-2 ${
                                    station.enabled
                                      ? 'border-amber-200/45 bg-amber-100/12'
                                      : 'border-slate-400/40 bg-slate-600/20'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <p className={`text-xs font-semibold ${
                                      station.enabled ? 'text-amber-100' : 'text-slate-300'
                                    }`}>
                                      {station.name}
                                    </p>
                                    <span className="rounded-full border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-100">
                                      {stationServiceModeLabel(station.serviceMode)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {workflowDraft.packagingStations.length === 0 && (
                              <span className="rounded-lg border border-dashed border-white/25 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-300">
                                尚未新增包裝工作站
                              </span>
                            )}
                          </div>
                        </article>

                        <div className="flex items-center px-1">
                          <div className="h-px w-full bg-emerald-200/60" />
                        </div>

                        <div>
                          <div className="rounded-2xl border border-emerald-200/45 bg-emerald-300/15 px-3 py-3 text-center backdrop-blur-sm">
                            <p className="text-xs font-semibold tracking-[0.08em] text-emerald-100">STEP 04</p>
                            <p className="mt-1 text-sm font-semibold text-white">完成出餐</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <section className={`${cardClass} bafang-enter space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">製作端工作站</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRODUCTION_MODULES.map((module) => (
                      <button
                        key={`add-production-station-${module}`}
                        type="button"
                        onClick={() => addDraftStation('production', module)}
                        className={`${actionButtonBase} min-h-9 border border-slate-300 bg-white px-3 text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                      >
                        新增{PRODUCTION_MODULE_LABEL[module]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  {workflowDraft.productionStations.map((station, index) =>
                    renderStationCard(
                      'production',
                      station,
                      index,
                      workflowDraft.productionStations.length,
                      sortedProductionOrders,
                    ),
                  )}
                </div>
              </section>

              <section className={`${cardClass} bafang-enter space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">包裝端工作站</h3>
                  <button
                    type="button"
                    onClick={() => addDraftStation('packaging')}
                    className={`${actionButtonBase} min-h-9 border border-slate-300 bg-white px-3 text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                  >
                    新增工作站
                  </button>
                </div>
                <div className="space-y-3">
                  {workflowDraft.packagingStations.map((station, index) =>
                    renderStationCard(
                      'packaging',
                      station,
                      index,
                      workflowDraft.packagingStations.length,
                      sortedPackagingOrders,
                    ),
                  )}
                </div>
              </section>
            </section>
          </section>
        )}

        {settingsPanel === 'menu' && (
          <section className="space-y-4">
            <section className={`${cardClass} bafang-enter space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-900">菜單</h3>
                <p className="text-xs font-semibold text-slate-500">以標籤分群管理品項</p>
              </div>

              <div className="relative overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-2 bafang-soft-scroll">
                <div className="flex min-w-max gap-2">
                  {menuTagTabs.map((tag) => {
                    const isActive = settingsMenuActiveTag === tag;
                    const count = tag === 'all'
                      ? workflowDraft.menuItems.length
                      : (menuItemCountByTag.get(tag) ?? 0);
                    return (
                      <button
                        key={`menu-tag-tab-${tag}`}
                        type="button"
                        onClick={() => setSettingsMenuActiveTag(tag)}
                        className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
                          isActive
                            ? 'border-amber-400 bg-amber-50 text-amber-900'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                        }`}
                      >
                        <span>{tag === 'all' ? '全部' : tag}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                          isActive ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {visibleDraftMenuItems.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {visibleDraftMenuItems.map((item) => renderDraftMenuItemCard(item))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-500">
                  這個標籤目前沒有品項
                </div>
              )}
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <section className={`${cardClass} bafang-enter space-y-3`}>
                <button
                  type="button"
                  onClick={() => setSettingsTagLibraryExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left"
                >
                  <p className="text-sm font-semibold text-slate-900">標籤</p>
                  <span className="text-xs font-semibold text-slate-500">
                    {settingsTagLibraryExpanded ? '收合' : '展開'}
                  </span>
                </button>
                <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                  settingsTagLibraryExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {workflowDraft.menuTags.map((tag) => (
                          <button
                            type="button"
                            key={`menu-tag-chip-${tag}`}
                            onClick={() => removeDraftMenuTag(tag)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              baseCategoryTagSet.has(tag)
                                ? 'border-slate-300 bg-white text-slate-700'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700'
                            }`}
                            title={baseCategoryTagSet.has(tag) ? '系統分類標籤不可刪除' : '點擊刪除標籤'}
                          >
                            <span>{tag}</span>
                            <span className="text-[10px] font-bold text-slate-400">{tagUsageCount.get(tag) ?? 0}</span>
                            {!baseCategoryTagSet.has(tag) && <span>×</span>}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={settingsNewTagInput}
                          onChange={(event) => setSettingsNewTagInput(event.target.value)}
                          placeholder="新增標籤"
                          className="h-10 w-full sm:w-[180px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-amber-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            addDraftMenuTag(settingsNewTagInput);
                            setSettingsNewTagInput('');
                          }}
                          className={`${actionButtonBase} min-h-10 border border-slate-300 bg-white px-3 text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                        >
                          新增標籤
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className={`${cardClass} bafang-enter space-y-3`}>
                <button
                  type="button"
                  onClick={() => setSettingsNewItemExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left"
                >
                  <p className="text-sm font-semibold text-slate-900">新增品項</p>
                  <span className="text-xs font-semibold text-slate-500">
                    {settingsNewItemExpanded ? '收合' : '展開'}
                  </span>
                </button>
                <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                  settingsNewItemExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="grid gap-3">
                        <input
                          type="text"
                          value={settingsNewMenuItem.name}
                          onChange={(event) => setSettingsNewMenuItem((prev) => ({ ...prev, name: event.target.value }))}
                          placeholder="品項名稱"
                          className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-amber-400 focus:outline-none"
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={settingsNewMenuItem.price}
                            onChange={(event) => setSettingsNewMenuItem((prev) => ({ ...prev, price: event.target.value }))}
                            placeholder="價格"
                            className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-amber-400 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={settingsNewMenuItem.tags}
                            onChange={(event) => setSettingsNewMenuItem((prev) => ({ ...prev, tags: event.target.value }))}
                            placeholder="標籤（逗號分隔）"
                            className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-amber-400 focus:outline-none"
                          />
                        </div>

                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">分類</p>
                          <div className="flex flex-wrap gap-1.5">
                            {WORKFLOW_MENU_CATEGORIES.map((category) => (
                              <button
                                key={`new-item-category-chip-${category}`}
                                type="button"
                                onClick={() =>
                                  setSettingsNewMenuItem((prev) => {
                                    const defaultPrep = getDefaultPrepConfigForMenuItem({ id: '', category });
                                    const prepStation = sanitizePrepStation(
                                      prev.prepStation,
                                      category,
                                      defaultPrep.prepStation,
                                    );
                                    const prepSeconds = String(
                                      sanitizePrepSeconds(
                                        prev.prepSeconds,
                                        defaultPrep.prepSeconds,
                                        prepStation,
                                      ),
                                    );
                                    return {
                                      ...prev,
                                      category,
                                      prepStation,
                                      prepSeconds: prepStation === 'none' ? '0' : prepSeconds,
                                    };
                                  })
                                }
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                  settingsNewMenuItem.category === category
                                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                                }`}
                              >
                                {getCategoryTag(category)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">單位</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(['顆', '份', '碗', '杯'] as const).map((unit) => (
                              <button
                                key={`new-item-unit-chip-${unit}`}
                                type="button"
                                onClick={() => setSettingsNewMenuItem((prev) => ({ ...prev, unit }))}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                  settingsNewMenuItem.unit === unit
                                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                                }`}
                              >
                                {unit}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">加選類型</p>
                          <div className="flex flex-wrap gap-1.5">
                            {([
                              { id: 'none', label: '無加選' },
                              { id: 'tofu_sauce', label: '豆腐口味' },
                              { id: 'noodle_staple', label: '麵條 / 冬粉' },
                              { id: 'soup_dumpling_flavor', label: '湯餃改口味' },
                            ] as Array<{ id: MenuOptionType; label: string }>).map((option) => (
                              <button
                                key={`new-item-option-chip-${option.id}`}
                                type="button"
                                onClick={() => setSettingsNewMenuItem((prev) => ({ ...prev, optionType: option.id }))}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                  settingsNewMenuItem.optionType === option.id
                                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">工作站 / 備餐耗時</p>
                          <div className="flex flex-wrap gap-1.5">
                            {getAllowedPrepStationsForCategory(settingsNewMenuItem.category).map((prepStation) => (
                              <button
                                key={`new-item-prep-station-chip-${prepStation}`}
                                type="button"
                                onClick={() =>
                                  setSettingsNewMenuItem((prev) => {
                                    const defaultPrep = getDefaultPrepConfigForMenuItem({
                                      id: '',
                                      category: prev.category,
                                    });
                                    const nextPrepStation = sanitizePrepStation(
                                      prepStation,
                                      prev.category,
                                      defaultPrep.prepStation,
                                    );
                                    const nextPrepSeconds = String(
                                      sanitizePrepSeconds(
                                        prev.prepSeconds,
                                        defaultPrep.prepSeconds,
                                        nextPrepStation,
                                      ),
                                    );
                                    return {
                                      ...prev,
                                      prepStation: nextPrepStation,
                                      prepSeconds: nextPrepStation === 'none' ? '0' : nextPrepSeconds,
                                    };
                                  })
                                }
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                  settingsNewMenuItem.prepStation === prepStation
                                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                                }`}
                              >
                                {PREP_STATION_LABEL[prepStation]}
                              </button>
                            ))}
                          </div>
                          {!settingsNewItemHidePrepSeconds && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-slate-500">耗時</span>
                              <input
                                type="number"
                                min={settingsNewMenuItem.prepStation === 'none' ? 0 : 1}
                                step={1}
                                value={settingsNewMenuItem.prepSeconds}
                                disabled={settingsNewMenuItem.prepStation === 'none'}
                                onChange={(event) =>
                                  setSettingsNewMenuItem((prev) => {
                                    const defaultPrep = getDefaultPrepConfigForMenuItem({
                                      id: '',
                                      category: prev.category,
                                    });
                                    const prepStation = sanitizePrepStation(
                                      prev.prepStation,
                                      prev.category,
                                      defaultPrep.prepStation,
                                    );
                                    const prepSeconds = String(
                                      sanitizePrepSeconds(
                                        event.target.value,
                                        defaultPrep.prepSeconds,
                                        prepStation,
                                      ),
                                    );
                                    return {
                                      ...prev,
                                      prepSeconds: prepStation === 'none' ? '0' : prepSeconds,
                                    };
                                  })
                                }
                                className="h-10 w-28 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400 focus:border-amber-400 focus:outline-none"
                              />
                              <span className="text-[11px] font-semibold text-slate-500">秒</span>
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={addDraftMenuItemFromSettings}
                          className={`${actionButtonBase} min-h-11 bg-[#1f3356] text-white hover:bg-[#2d4770]`}
                        >
                          新增品項
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </section>
          </section>
        )}

        {settingsPanel === 'apiHub' && (
          <section className="space-y-4 bafang-enter">
            {/* --- 硬體模組開關 --- */}
            <section className={`${cardClass} space-y-4`}>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">硬體模組</h3>
                <p className="mt-0.5 text-xs text-slate-500">啟用或停用硬體整合模組，停用後對應的 API 端點會從下方目錄隱藏</p>
              </div>
              <div className="space-y-2">
                {HW_MODULE_REGISTRY.map((mod) => (
                  <label key={mod.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800">{mod.label}</span>
                      <span className="block text-xs text-slate-500">{mod.description}</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hwModules[mod.id]}
                      onClick={() => toggleHwModule(mod.id)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${hwModules[mod.id] ? 'bg-emerald-500' : 'bg-slate-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${hwModules[mod.id] ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </label>
                ))}
              </div>
            </section>

            {/* --- 入站 API 端點目錄 --- */}
            <section className={`${cardClass} space-y-4`}>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">入站 API 端點</h3>
                <p className="mt-0.5 text-xs text-slate-500">外部硬體呼叫本系統的 API 端點（依啟用的模組顯示）</p>
              </div>
              {HW_MODULE_REGISTRY.filter((mod) => hwModules[mod.id]).flatMap((mod) => mod.apis).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center">
                  <p className="text-sm text-slate-500">尚未啟用任何硬體模組</p>
                  <p className="mt-1 text-xs text-slate-400">請在上方開啟模組以顯示對應的 API 端點</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {HW_MODULE_REGISTRY.filter((mod) => hwModules[mod.id]).flatMap((mod) =>
                    mod.apis.map((api) => {
                      const resolvedPath = api.pathTemplate.replace(':storeId', authUser.storeId);
                      const fullUrl = `${window.location.origin}${resolvedPath}`;
                      return (
                        <div key={api.pathTemplate} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                          <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">{api.method}</span>
                          <div className="min-w-0 flex-1">
                            <code className="block truncate text-xs text-slate-700">{fullUrl}</code>
                            <span className="block text-xs text-slate-500">{api.description}</span>
                          </div>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{mod.label}</span>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(fullUrl); }}
                            className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            複製
                          </button>
                        </div>
                      );
                    }),
                  )}
                </div>
              )}
            </section>

            {/* --- 硬體設備 API 連線（既有區段） --- */}
            <section className={`${cardClass} space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">硬體設備 API 連線</h3>
                  <p className="mt-0.5 text-xs text-slate-500">管理店內硬體設備（出單機、標籤機、電子秤、叫號螢幕等）的 API 端點與認證設定</p>
                </div>
                <button
                  type="button"
                  onClick={addApiHubDevice}
                  className={`${actionButtonBase} min-h-10 bg-[#1f3356] px-4 text-white hover:bg-[#2d4770]`}
                >
                  新增裝置
                </button>
              </div>

              {apiHubDevices.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center">
                  <p className="text-sm text-slate-500">尚未新增任何裝置</p>
                  <p className="mt-1 text-xs text-slate-400">點擊「新增裝置」開始設定硬體 API 連線</p>
                </div>
              )}

              <div className="space-y-3">
                {apiHubDevices.map((device) => {
                  const isExpanded = apiHubExpandedId === device.id;
                  const isTesting = apiHubTestingId === device.id;
                  const statusColor = device.lastTestStatus === 'ok' ? 'bg-emerald-400' : device.lastTestStatus === 'error' ? 'bg-red-400' : 'bg-slate-300';
                  return (
                    <div key={device.id} className="rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-sm">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3 text-left"
                        onClick={() => setApiHubExpandedId(isExpanded ? null : device.id)}
                      >
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor}`} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                          {device.name || '（未命名裝置）'}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {DEVICE_TYPE_LABEL[device.deviceType]}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${device.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {device.enabled ? '啟用' : '停用'}
                        </span>
                        <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </button>

                      {isExpanded && (
                        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold text-slate-600">裝置名稱</span>
                              <input
                                type="text"
                                value={device.name}
                                onChange={(e) => updateApiHubDevice(device.id, { name: e.target.value })}
                                placeholder="例：前台出單機"
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold text-slate-600">裝置類型</span>
                              <select
                                value={device.deviceType}
                                onChange={(e) => updateApiHubDevice(device.id, { deviceType: e.target.value as HardwareDeviceType })}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500"
                              >
                                {DEVICE_TYPE_OPTIONS.map((dt) => (
                                  <option key={dt} value={dt}>{DEVICE_TYPE_LABEL[dt]}</option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-600">Endpoint URL</span>
                            <input
                              type="url"
                              value={device.endpointUrl}
                              onChange={(e) => updateApiHubDevice(device.id, { endpointUrl: e.target.value })}
                              placeholder="https://192.168.1.100:8080/api"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500"
                            />
                          </label>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold text-slate-600">認證方式</span>
                              <select
                                value={device.authMethod}
                                onChange={(e) => updateApiHubDevice(device.id, { authMethod: e.target.value as DeviceAuthMethod })}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500"
                              >
                                {(['none', 'api_key', 'bearer_token'] as DeviceAuthMethod[]).map((m) => (
                                  <option key={m} value={m}>{AUTH_METHOD_LABEL[m]}</option>
                                ))}
                              </select>
                            </label>
                            {device.authMethod !== 'none' && (
                              <label className="block">
                                <span className="mb-1 block text-xs font-semibold text-slate-600">
                                  {device.authMethod === 'api_key' ? 'API Key' : 'Bearer Token'}
                                </span>
                                <input
                                  type="password"
                                  value={device.authSecret}
                                  onChange={(e) => updateApiHubDevice(device.id, { authSecret: e.target.value })}
                                  placeholder="輸入密鑰…"
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500"
                                />
                              </label>
                            )}
                          </div>

                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={device.enabled}
                              onChange={(e) => updateApiHubDevice(device.id, { enabled: e.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="text-sm font-semibold text-slate-700">啟用此裝置</span>
                          </label>

                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-600">備註</span>
                            <textarea
                              value={device.note}
                              onChange={(e) => updateApiHubDevice(device.id, { note: e.target.value })}
                              rows={2}
                              placeholder="選填備註…"
                              className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500"
                            />
                          </label>

                          {device.lastTestAt !== null && (
                            <p className={`text-xs font-semibold ${device.lastTestStatus === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
                              上次測試：{device.lastTestStatus === 'ok' ? '連線成功' : '連線失敗'}
                              （{new Date(device.lastTestAt).toLocaleTimeString('zh-TW')}）
                            </p>
                          )}

                          <div className="flex items-center gap-3 pt-1">
                            <button
                              type="button"
                              disabled={!device.endpointUrl || isTesting}
                              onClick={() => testApiHubDevice(device.id)}
                              className={`${actionButtonBase} min-h-10 bg-emerald-600 px-4 text-white hover:bg-emerald-700 disabled:opacity-50`}
                            >
                              {isTesting ? '測試中…' : '測試連線'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeApiHubDevice(device.id)}
                              className={`${actionButtonBase} min-h-10 border border-red-300 bg-white px-4 text-red-600 hover:border-red-400 hover:bg-red-50`}
                            >
                              刪除裝置
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </section>
        )}
      </section>
    );
  };

  const renderIngestWorkspace = () => (
    <section className="space-y-5 sm:space-y-6">
      <IngestEnginePanel
        storeId={authUser.storeId}
        onDispatchReviewOrder={handleDispatchReviewOrder}
        onEditReviewOrder={handleEditReviewOrder}
        onResolveIngestItem={resolveIngestItemForPending}
        externalNotifications={ingestDispatchNotices}
      />
    </section>
  );

  const perspectiveTabsAll: Array<{ id: AppPerspective; label: string }> = [
    { id: 'customer', label: '點餐' },
    { id: 'production', label: '製作' },
    { id: 'packaging', label: '包裝' },
    { id: 'settings', label: '設定' },
    ...(featureFlags.ingestEngine ? [{ id: 'ingest' as AppPerspective, label: '進單引擎' }] : []),
  ];
  const perspectiveTabs = perspectiveTabsAll.filter(
    (tab) => isPerspectiveAllowed(tab.id),
  );
  const customerTabs: Array<{ id: CustomerPage; label: string; disabled: boolean }> = [
    { id: 'landing', label: '用餐方式', disabled: false },
    { id: 'ordering', label: '點餐', disabled: !serviceMode },
    { id: 'cart', label: '購物車', disabled: !serviceMode },
  ];
  const perspectiveIndex = Math.max(
    0,
    perspectiveTabs.findIndex((tab) => tab.id === activePerspective),
  );
  const customerPageIndex = Math.max(
    0,
    customerTabs.findIndex((tab) => tab.id === customerPage),
  );
  const perspectiveStep = 100 / Math.max(1, perspectiveTabs.length);
  const customerStep = 100 / customerTabs.length;
  const minimalTextMode = activePerspective === 'packaging' || activePerspective === 'ingest';

  return (
    <div className={`bafang-page-bg ${minimalTextMode ? 'bafang-minimal' : ''} min-h-screen ${
      workspaceFullscreen
        ? 'px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-3'
        : 'px-3 py-4 pb-[calc(7.4rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-6 sm:pb-[calc(7.25rem+env(safe-area-inset-bottom))] md:px-7 lg:px-10'
    }`}>
      <div className={`fixed right-3 z-[86] flex flex-col items-end gap-2 sm:right-4 ${
        workspaceFullscreen
          ? 'bottom-2 sm:bottom-3'
          : 'bottom-[calc(5.4rem+env(safe-area-inset-bottom))] sm:bottom-[calc(5.2rem+env(safe-area-inset-bottom))]'
      }`}>
        <button
          type="button"
          onClick={() => {
            toggleWorkspaceFullscreen().catch(() => undefined);
          }}
          className={`bafang-glass inline-flex items-center justify-center rounded-xl font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-white/80 ${
            workspaceFullscreen
              ? 'h-8 w-20 px-2 text-xs'
              : 'h-10 w-28 px-3 text-sm'
          }`}
        >
          {workspaceFullscreen ? '退出全螢幕' : '全螢幕'}
        </button>
        {!workspaceFullscreen && (
          <button
            type="button"
            onClick={() => {
              void handleShellLogout();
            }}
            disabled={logoutBusy}
            className="bafang-glass inline-flex h-9 w-28 items-center justify-center rounded-xl px-3 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50/75 disabled:opacity-55"
          >
            {logoutBusy ? '登出中...' : '登出'}
          </button>
        )}
      </div>

      {!workspaceFullscreen && (
        <header className="mx-auto mb-5 max-w-[1480px] md:mb-7">
          <p className="bafang-keep-caption pl-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-700 sm:text-xs md:text-sm">
            BAFANG PRO OPERATIONS
          </p>
          <h1 className="mt-2 text-[clamp(2rem,5.8vw,4rem)] font-black leading-tight tracking-[0.12em] text-[#20365a]">
            八方PRO
          </h1>
        </header>
      )}

      <main className={`mx-auto space-y-5 sm:space-y-6 ${workspaceFullscreen ? 'max-w-none pt-12' : 'max-w-[1480px]'}`}>
        {isCommandHubMode && (
          <>
            <section className={`${cardClass} bafang-enter space-y-3`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Command Hub</h2>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-slate-500">
                    {commandHubLastSyncedAt
                      ? `更新於 ${formatShortTime(commandHubLastSyncedAt)}`
                      : '尚未同步'}
                  </p>
                  <button
                    type="button"
                    onClick={refreshCommandHubQueues}
                    disabled={commandHubLoading}
                    className={`${actionButtonBase} min-h-9 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {commandHubLoading ? '同步中...' : '重新整理'}
                  </button>
                </div>
              </div>

              {commandHubLoadError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                  訂單清單讀取失敗：{commandHubLoadError}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-amber-900">待審核</h3>
                    <span className="inline-flex h-6 items-center rounded-full border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-800">
                      {commandHubPendingReviewOrders.length}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {commandHubPendingReviewOrders.slice(0, 8).map((order) => (
                      <li key={`command-hub-pending-${order.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5">
                        <span className="truncate text-sm font-semibold text-slate-900">{order.id}</span>
                        <span className="shrink-0 text-[11px] font-semibold text-slate-500">
                          {formatShortTime(order.updatedAt ?? order.createdAt)}
                        </span>
                      </li>
                    ))}
                    {commandHubPendingReviewOrders.length === 0 && (
                      <li className="rounded-lg border border-dashed border-amber-300 bg-white px-2.5 py-2 text-xs font-medium text-amber-800">
                        無待審核
                      </li>
                    )}
                  </ul>
                </section>

                <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-sky-900">追蹤中</h3>
                    <span className="inline-flex h-6 items-center rounded-full border border-sky-300 bg-white px-2 text-xs font-semibold text-sky-800">
                      {commandHubTrackingOrders.length}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {commandHubTrackingOrders.slice(0, 8).map((order) => (
                      <li key={`command-hub-tracking-${order.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5">
                        <span className="truncate text-sm font-semibold text-slate-900">{order.id}</span>
                        <span className="shrink-0 text-[11px] font-semibold text-slate-500">
                          {formatShortTime(order.updatedAt ?? order.createdAt)}
                        </span>
                      </li>
                    ))}
                    {commandHubTrackingOrders.length === 0 && (
                      <li className="rounded-lg border border-dashed border-sky-300 bg-white px-2.5 py-2 text-xs font-medium text-sky-800">
                        無追蹤中
                      </li>
                    )}
                  </ul>
                </section>
              </div>
            </section>

          </>
        )}

        {activePerspective === 'customer' && (
          <>
            <section className={`${cardClass} bafang-enter space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-700 sm:text-base">
                  {customerPage === 'landing'
                    ? '選擇用餐方式'
                    : serviceMode
                      ? `服務方式：${serviceModeLabel(serviceMode)}`
                      : '先選擇用餐方式'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTutorialToggle}
                    className={`${actionButtonBase} min-h-10 border px-3 ${
                      customerTutorialEnabled
                        ? 'border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 hover:bg-sky-100'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    導覽模式 {customerTutorialEnabled ? '開啟' : '關閉'}
                  </button>
                  <button
                    type="button"
                    onClick={startCustomerTutorial}
                    className={`${actionButtonBase} min-h-10 border border-slate-300 bg-white px-3 text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                  >
                    {customerTutorialCompleted ? '重新導覽' : '開始導覽'}
                  </button>
                </div>
              </div>
              {!workspaceFullscreen && (
                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/75 p-1 shadow-sm">
                  <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
                    <div
                      className="h-full rounded-xl bg-gradient-to-r from-slate-300/85 to-slate-200/90 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{
                        width: `${customerStep}%`,
                        transform: `translateX(${customerPageIndex * 100}%)`,
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                      }}
                    />
                  </div>
                  <div className={`pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-slate-100/85 via-slate-100/50 to-transparent transition-[opacity,transform] duration-500 ease-out ${
                    customerPageIndex === 0 ? 'opacity-0 -translate-x-1' : 'opacity-100 translate-x-0'
                  }`} />
                  <div className={`pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-slate-100/85 via-slate-100/50 to-transparent transition-[opacity,transform] duration-500 ease-out ${
                    customerPageIndex === customerTabs.length - 1 ? 'opacity-0 translate-x-1' : 'opacity-100 translate-x-0'
                  }`} />
                  <div className="relative grid grid-cols-3">
                    {customerTabs.map((tab) => (
                      <button
                        key={tab.id}
                        className={`${railButtonBase} ${
                          customerPage === tab.id
                            ? 'text-slate-900'
                            : 'text-slate-600'
                        }`}
                        onClick={() => {
                          if (tab.id === 'cart') {
                            scrollToCart();
                            return;
                          }
                          setCustomerPage(tab.id);
                        }}
                        disabled={tab.disabled}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {customerPage === 'landing' && (
              <section className={`${cardClass} bafang-enter space-y-5`}>
                <h2 className="text-2xl font-semibold text-slate-900">用餐方式</h2>
                <p className="mt-2 text-sm font-medium text-slate-600">先決定內用或外帶，再進入點餐流程。</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    className={`${actionButtonBase} min-h-14 bg-amber-500 text-base text-white hover:bg-amber-600`}
                    onClick={() => {
                      handleServiceModeSelect('dine_in');
                    }}
                  >
                    內用
                  </button>
                  <button
                    className={`${actionButtonBase} min-h-14 border border-slate-300 bg-white text-base text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                    onClick={() => {
                      handleServiceModeSelect('takeout');
                    }}
                  >
                    外帶
                  </button>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">隨機生成測試訂單</h3>
                      <p className="text-xs font-medium text-slate-500">
                        快速產生訂單並送到製作端、包裝端。
                      </p>
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <label htmlFor="seed-order-count" className="text-xs font-semibold text-slate-600">
                        數量
                      </label>
                      <input
                        id="seed-order-count"
                        type="number"
                        min={1}
                        max={30}
                        value={seedOrderInput}
                        onChange={(event) => setSeedOrderInput(event.target.value)}
                        className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-800"
                      />
                      <button
                        className={`${actionButtonBase} min-h-10 bg-[#1f3356] px-3 text-white hover:bg-[#2d4770]`}
                        onClick={generateSeedOrders}
                      >
                        產生訂單
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 h-5">
                    <p className={`text-xs font-semibold text-emerald-700 transition-all duration-500 ${
                      seedOrdersNotice
                        ? seedOrdersNotice.phase === 'show'
                          ? 'opacity-100 translate-y-0'
                          : 'opacity-0 -translate-y-1'
                        : 'opacity-0'
                    }`}>
                      {seedOrdersNotice
                        ? `已新增 ${seedOrdersNotice.count} 筆測試訂單`
                        : '已新增 0 筆測試訂單'}
                    </p>
                  </div>
                </section>
              </section>
            )}

            {customerPage === 'ordering' && (
              <section className="space-y-5 sm:space-y-6">
                <div className={`${cardClass} bafang-enter space-y-4`}>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                    <button
                      className={`${actionButtonBase} col-span-2 w-full justify-between bg-[#1f3356] text-white hover:bg-[#2d4770] sm:w-auto`}
                      onClick={scrollToCart}
                    >
                      <span>前往購物車</span>
                      <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
                        {cartButtonCount}
                      </span>
                    </button>
                  </div>

                  <div className="-mx-2 overflow-x-auto overflow-y-visible px-2 py-3 overscroll-x-contain bafang-soft-scroll">
                    <div className="flex min-w-full gap-2.5 snap-x snap-mandatory scroll-px-2">
                      {visibleMenuCategories.map((category) => {
                        const isActive = category.id === activeCategory;
                        return (
                          <button
                            key={category.id}
                            ref={(node) => {
                              setTutorialTargetRef(`category-${category.id}`, node);
                            }}
                            onClick={() => handleCustomerCategorySelect(category.id)}
                            className={`min-h-12 min-w-[130px] shrink-0 snap-start rounded-xl border px-3 py-3 text-left transition-all duration-300 sm:min-w-[144px] md:min-w-[156px] ${
                              isActive
                                ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-sm shadow-amber-200/80'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            } ${getTutorialFocusClass(`category-${category.id}`)}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold">{category.label}</p>
                              {categoryItemCount[category.id] > 0 && (
                                <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                                  isActive ? 'bg-amber-200/90 text-amber-900' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {categoryItemCount[category.id]}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {activeBoxCategory ? (
                  renderBoxOrdering(activeBoxCategory)
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {categoryItems.map((item) => renderMenuCard(item))}
                  </div>
                )}
              </section>
            )}

            {customerPage === 'cart' && (
              <section ref={cartSectionRef} className={`${cardClass} bafang-enter`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-xl font-semibold text-slate-900">購物車</h2>
                  <p className="text-xs font-medium text-slate-500">品項 / 數量 / 單價 / 小計</p>
                </div>

                <div className="mt-4 h-14">
                  <div className={`h-full rounded-2xl border px-4 py-3 text-sm font-medium transition-all duration-500 ${
                    submitNotice
                      ? submitNotice.phase === 'show'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 opacity-100 translate-y-0'
                        : 'border-emerald-200/70 bg-emerald-50/75 text-emerald-700 opacity-0 -translate-y-1'
                      : 'pointer-events-none border-transparent bg-transparent text-transparent opacity-0 translate-y-1'
                  }`}>
                    {submitNotice ? `訂單已送出：${submitNotice.orderId}（已同步到製作端與包裝端）` : '訂單已送出'}
                  </div>
                </div>

                {cart.length === 0 && boxSummary.every((row) => row.items.length === 0) && (
                  <div className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-500">
                    還沒加入任何品項，先回點餐頁挑選。
                  </div>
                )}

                {(cart.length > 0 || boxSummary.some((row) => row.items.length > 0)) && (
                  <div className="mt-2 space-y-3">
                    {cart.map((line) => {
                      const subtotal = line.unitPrice * line.quantity;
                      return (
                        <article key={line.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-slate-900">
                                {line.name}
                                {line.customLabel ? ` - ${line.customLabel}` : ''}
                              </h3>
                              <p className="mt-1 text-xs font-medium text-slate-500">
                                單價 {currency(line.unitPrice)} / {line.unitLabel}
                              </p>
                              {line.note && (
                                <p className="mt-1 text-xs font-medium text-amber-700">
                                  備註：{line.note}
                                </p>
                              )}
                            </div>
                            <p className="text-sm font-semibold text-slate-900">{currency(subtotal)}</p>
                          </div>

                          {(line.soupSurchargePerUnit ?? 0) > 0 && (
                            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                              已含口味加價 {currency(line.soupSurchargePerUnit ?? 0)} / 碗
                            </p>
                          )}

                          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2">
                              <button
                                className="bafang-press-control inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                                onClick={() => updateLineQuantity(line.id, -1)}
                              >
                                −
                              </button>
                              <span className="min-w-[2rem] text-center text-sm font-semibold text-slate-900">{line.quantity}</span>
                              <button
                                className="bafang-press-control inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-lg font-semibold text-white transition hover:bg-amber-600"
                                onClick={() => updateLineQuantity(line.id, 1)}
                                onContextMenu={(event) => event.preventDefault()}
                              >
                                +
                              </button>
                            </div>
                            <button
                              className="self-end text-xs font-semibold text-rose-600 transition hover:text-rose-700"
                              onClick={() => removeLine(line.id)}
                            >
                              移除
                            </button>
                          </div>
                        </article>
                      );
                    })}

                    {boxSummary
                      .filter((row) => row.items.length > 0)
                      .map((row) => (
                        <article key={row.id} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">{row.typeLabel}</p>
                              <h3 className="text-sm font-semibold text-amber-900">{row.boxLabel}</h3>
                            </div>
                            <p className="text-sm font-semibold text-amber-900">{currency(row.subtotal)}</p>
                          </div>
                          <ul className="mt-2 space-y-1 text-xs font-medium text-amber-900">
                            {row.items.map((item) => (
                              <li key={`${row.id}-${item.name}`} className="flex justify-between">
                                <span>{item.name} × {item.count}</span>
                                <span>{currency(item.subtotal)}</span>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}

                    {soupSurchargeRows.length > 0 && (
                      <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                        <h3 className="text-sm font-semibold text-amber-900">口味加價已計入</h3>
                        <div className="mt-2 space-y-2">
                          {soupSurchargeRows.map((line) => (
                            <p key={`surcharge-${line.id}`} className="text-xs font-medium text-amber-800">
                              {line.name} - {line.soupFlavorName}：{currency((line.soupSurchargePerUnit ?? 0) * line.quantity)}
                            </p>
                          ))}
                        </div>
                      </section>
                    )}

                    <label className="block space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                      <span className="text-sm font-semibold text-slate-800">整筆訂單備註</span>
                      <textarea
                        value={cartOrderNote}
                        maxLength={120}
                        onChange={(event) => setCartOrderNote(event.target.value)}
                        className="min-h-[84px] w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-amber-400 focus:outline-none"
                      />
                    </label>

                    <div className="rounded-2xl border border-[#1f3356] bg-[#1f3356] px-4 py-3 text-white">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-200">總金額</span>
                        <span className="text-2xl font-semibold">{currency(totalAmount)}</span>
                      </div>
                    </div>

                    <button
                      className={`${actionButtonBase} w-full border border-rose-300 bg-white text-rose-700 hover:border-rose-400 hover:bg-rose-50`}
                      onClick={() => {
                        clearAllOrders();
                        setCustomerPage('ordering');
                      }}
                      disabled={!hasAnySelection}
                    >
                      取消訂單
                    </button>

                    <button
                      className={`${actionButtonBase} w-full bg-emerald-600 text-white hover:bg-emerald-700`}
                      onClick={submitOrder}
                      disabled={!hasAnySelection || !serviceMode}
                    >
                      下單送出
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {activePerspective === 'production' && renderProductionWorkspace()}
        {activePerspective === 'packaging' && renderPackagingWorkspace()}
        {activePerspective === 'settings' && renderSettingsWorkspace()}
        {activePerspective === 'ingest' && renderIngestWorkspace()}
      </main>

      {activePerspective === 'customer' && customerTutorialActive && tutorialSpotlightRect && (
        <>
          <div className="pointer-events-none fixed inset-0 z-[58]">
            <div
              className="pointer-events-auto absolute left-0 right-0 top-0 bg-slate-900/60 transition-[height] duration-[820ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ height: `${tutorialSpotlightRect.top}px` }}
            />
            <div
              className="pointer-events-auto absolute left-0 bg-slate-900/60 transition-[top,width,height] duration-[820ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                top: `${tutorialSpotlightRect.top}px`,
                width: `${tutorialSpotlightRect.left}px`,
                height: `${tutorialSpotlightRect.height}px`,
              }}
            />
            <div
              className="pointer-events-auto absolute right-0 bg-slate-900/60 transition-[top,width,height] duration-[820ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                top: `${tutorialSpotlightRect.top}px`,
                width: `calc(100vw - ${tutorialSpotlightRect.left + tutorialSpotlightRect.width}px)`,
                height: `${tutorialSpotlightRect.height}px`,
              }}
            />
            <div
              className="pointer-events-auto absolute bottom-0 left-0 right-0 bg-slate-900/60 transition-[top] duration-[820ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                top: `${tutorialSpotlightRect.top + tutorialSpotlightRect.height}px`,
              }}
            />
          </div>
          {tutorialTooltipStyle && (
            <aside
              className="fixed z-[67] pointer-events-auto w-[min(340px,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-white/20 bg-slate-900/94 p-3.5 text-slate-100 shadow-2xl shadow-slate-900/35 backdrop-blur-sm transition-[top,left,width,max-height,opacity] duration-[820ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:p-4 bafang-soft-scroll"
              style={{
                top: `${tutorialTooltipStyle.top}px`,
                left: `${tutorialTooltipStyle.left}px`,
                width: `${tutorialTooltipStyle.width}px`,
                maxHeight: `${tutorialTooltipStyle.maxHeight}px`,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">操作導覽</p>
                  <h3 className="mt-0.5 text-sm font-semibold text-white sm:text-[15px]">{customerTutorialCurrentLabel.title}</h3>
                </div>
                <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-100">
                  {customerTutorialStepIndex + 1}/{CUSTOMER_TUTORIAL_STEPS.length}
                </span>
              </div>
              <p className="mt-2 text-xs font-medium leading-relaxed text-slate-200">{customerTutorialCurrentLabel.description}</p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-emerald-300 transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: `${customerTutorialProgress}%` }}
                />
              </div>
              <div className="mt-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2">
                <p className="text-[11px] font-medium text-slate-300">下一步</p>
                <p className="mt-0.5 text-sm font-semibold text-white">
                  {tutorialNextStep ? tutorialStepTitle(tutorialNextStep) : '完成導覽'}
                </p>
              </div>
              <p className={`mt-2 text-[11px] font-medium ${tutorialStepReady ? 'text-emerald-300' : 'text-amber-200'}`}>
                {tutorialStepReady ? '這一步完成了，您可以前往下一步。' : '先完成目前這一步，再按下一步。'}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {(customerTutorialStep === 'box_switch' || customerTutorialStep === 'switch_category' || customerTutorialStep === 'add_item_open') && (
                  <button
                    type="button"
                    onClick={jumpToTutorialTarget}
                    className={`${actionButtonBase} min-h-9 border border-white/25 bg-white/10 px-2.5 text-xs text-slate-100 hover:border-white/35 hover:bg-white/15`}
                  >
                    前往目標
                  </button>
                )}
                <button
                  type="button"
                  onClick={goToNextTutorialStep}
                  disabled={!tutorialCanProceed}
                  className={`${actionButtonBase} min-h-9 px-3 text-xs ${
                    tutorialCanProceed
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'cursor-not-allowed bg-slate-700 text-slate-400'
                  }`}
                >
                  {tutorialNextStep ? '下一步' : '完成導覽'}
                </button>
                <button
                  type="button"
                  onClick={skipCustomerTutorial}
                  className={`${actionButtonBase} min-h-9 border border-white/25 bg-transparent px-2.5 text-xs text-slate-200 hover:border-white/40 hover:bg-white/10`}
                >
                  結束導覽
                </button>
              </div>
            </aside>
          )}
        </>
      )}

      {reviewAlertToast && (
        <aside
          className={`fixed right-3 top-4 z-[92] w-[min(320px,calc(100vw-1.5rem))] sm:right-4 ${
            reviewAlertToast.phase === 'show'
              ? 'bafang-toast-enter'
              : 'bafang-toast-exit'
          }`}
        >
          <div className="bafang-glass rounded-2xl border border-rose-300/90 bg-[linear-gradient(135deg,rgba(255,241,242,0.82),rgba(254,226,226,0.66))] px-3 py-2 shadow-lg shadow-rose-200/50">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">Review Alert</p>
            <p className="mt-1 text-sm font-semibold text-rose-900">{reviewAlertToast.text}</p>
          </div>
        </aside>
      )}

      {!workspaceFullscreen && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/70 bg-white/62 backdrop-blur-xl">
          <div className="mx-auto max-w-[1480px] px-3 pb-[calc(0.45rem+env(safe-area-inset-bottom))] pt-2 sm:px-5 md:px-7 lg:px-8">
            <div className="bafang-glass relative isolate overflow-hidden rounded-xl border border-slate-200/80 p-1 shadow-md shadow-slate-300/20">
              <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
                <div
                  className="h-full rounded-xl bg-gradient-to-r from-[#20365a] to-[#2d4770] transition-transform duration-300 ease-out"
                  style={{
                    width: `${perspectiveStep}%`,
                    transform: `translate3d(${perspectiveIndex * 100}%, 0, 0)`,
                    willChange: 'transform',
                    backfaceVisibility: 'hidden',
                  }}
                />
              </div>

              <div
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, perspectiveTabs.length)}, minmax(0, 1fr))` }}
              >
                {perspectiveTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={`${railButtonBase} ${
                      activePerspective === tab.id
                        ? 'text-white'
                        : 'bg-transparent text-slate-700'
                    }`}
                    onClick={() => requestPerspectiveChange(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppShell;
