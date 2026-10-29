/** Data-access contracts. Routes only know these, so tests run without a database. */

export const EXAMS = ['Boards', 'JEE', 'NEET', 'UPSC', 'College', 'Other'] as const;
export type Exam = (typeof EXAMS)[number];

export type StoredSubscriptionStatus = 'NONE' | 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED';

export type Role = 'student' | 'parent' | 'child';

export interface UserRecord {
  id: string;
  authUid: string;
  role: Role;
  name: string | null;
  email: string | null;
  phone: string | null;
  exam: string | null;
  /** Free text the student typed, cleaned up by the AI ("jee main 27" -> "JEE Main 2027"). */
  prepGoal: string | null;
  dailyGoalMin: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields a caller may change. `undefined` means "leave as is". */
export interface UserUpdate {
  name?: string;
  email?: string;
  phone?: string;
  exam?: Exam;
  prepGoal?: string;
  dailyGoalMin?: number;
  /** Only used when the account is created: a role never changes afterwards. */
  role?: Role;
}

export interface SubscriptionRecord {
  /** The Play product: which plan this is (student or parent). */
  productId?: string;
  status: StoredSubscriptionStatus;
  expiresAt: Date | null;
  autoRenewing: boolean;
}

export interface BackupRecord {
  payload: unknown;
  updatedAt: Date;
}

export interface UsersRepo {
  findByAuthUid(uid: string): Promise<UserRecord | null>;
  upsertByAuthUid(uid: string, update: UserUpdate): Promise<UserRecord>;
  /** Removes the user and everything tied to them (subscription, backup, AI usage). Returns false if there was none. */
  deleteByAuthUid(uid: string): Promise<boolean>;
  /** A student who buys the Parent plan becomes a parent. Children never change role. */
  setRole(userId: string, role: Role): Promise<void>;
}

/** Everything we store about a subscription (purchaseToken is the Razorpay subscription id, playState its raw status). */
export interface SubscriptionWrite {
  productId: string;
  purchaseToken: string;
  linkedPurchaseToken: string | null;
  status: StoredSubscriptionStatus;
  expiresAt: Date | null;
  autoRenewing: boolean;
  acknowledged: boolean;
  latestOrderId: string | null;
  playState: string | null;
}

export interface SubscriptionRow extends SubscriptionWrite {
  userId: string;
}

export interface SubscriptionsRepo {
  findByUserId(userId: string): Promise<SubscriptionRecord | null>;
  findByToken(purchaseToken: string): Promise<SubscriptionRow | null>;
  /** Creates or replaces the user's one subscription (a re-subscribe brings a new token). */
  save(userId: string, sub: SubscriptionWrite): Promise<void>;
  findRowByUserId(userId: string): Promise<SubscriptionRow | null>;
}

export interface BackupsRepo {
  get(userId: string): Promise<BackupRecord | null>;
  put(userId: string, payload: unknown): Promise<Date>;
}

/** Fixed-window counter, shared by all server instances when it is backed by the database. */
export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }>;
}

export interface OtpRecord {
  codeHash: string;
  attempts: number;
  expiresAt: Date;
}

export interface SessionOwner {
  authUid: string;
  phone: string | null;
}

/** Login codes and signed-in devices. */
export interface AuthRepo {
  /** Replaces any pending code for this phone and resets its attempt count. */
  saveOtp(phone: string, codeHash: string, expiresAt: Date): Promise<void>;
  getOtp(phone: string): Promise<OtpRecord | null>;
  /** Counts one wrong guess and returns the new total. */
  addOtpAttempt(phone: string): Promise<number>;
  deleteOtp(phone: string): Promise<void>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** The owner of an unexpired session, or null. */
  findSession(tokenHash: string): Promise<SessionOwner | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Signs a user out everywhere (used when a child is re-linked or removed). */
  deleteSessionsForUser(userId: string): Promise<void>;
}

/** Daily AI counters and the cached nudge line (table ai_usage). `day` is an Indian calendar date, YYYY-MM-DD. */
export interface AiRepo {
  /** Counts one chat message if the user is under [limit] today. Returns whether it was allowed and how many are left. */
  useChat(userId: string, day: string, limit: number): Promise<{ allowed: boolean; remaining: number }>;
  /** Gives one message back (the model call failed, so the user should not pay for it). */
  refundChat(userId: string, day: string): Promise<void>;
  getNudge(userId: string, day: string): Promise<{ text: string; createdAt: Date } | null>;
  /** Today's study-tip lines (used for notifications), or null if none were made yet. */
  getTips(userId: string, day: string): Promise<string[] | null>;
  saveTips(userId: string, day: string, tips: string[]): Promise<void>;
  saveNudge(userId: string, day: string, text: string): Promise<void>;
}

export interface ChildRecord {
  id: string;
  parentUserId: string;
  /** The child's own users row. */
  userId: string;
  name: string;
  prepGoal: string | null;
  enabled: boolean;
  /** True once the child has signed in with the code (a session exists or existed). */
  linked: boolean;
  createdAt: Date;
}

export interface UnlockRecord {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

/** Parents and their children (at most 3 each). Codes are stored only as keyed hashes. */
export interface FamilyRepo {
  countChildren(parentUserId: string): Promise<number>;
  /** Creates the child profile and its own user row (role 'child'), with a first link code. */
  createChild(parentUserId: string, name: string, prepGoal: string | null, linkCodeHash: string, linkExpiresAt: Date): Promise<ChildRecord>;
  listChildren(parentUserId: string): Promise<ChildRecord[]>;
  getChild(parentUserId: string, childId: string): Promise<ChildRecord | null>;
  findChildByUserId(userId: string): Promise<ChildRecord | null>;
  updateChild(childId: string, update: { name?: string; prepGoal?: string; enabled?: boolean }): Promise<void>;
  setLinkCode(childId: string, codeHash: string, expiresAt: Date): Promise<void>;
  /** The child behind an unexpired link code. */
  findByLinkCodeHash(codeHash: string): Promise<ChildRecord | null>;
  /** A link code works once: after redeeming, it is cleared and the child counts as linked. */
  consumeLinkCode(childId: string): Promise<void>;
  setUnlockCode(childId: string, codeHash: string, expiresAt: Date): Promise<void>;
  getUnlock(childId: string): Promise<UnlockRecord | null>;
  addUnlockAttempt(childId: string): Promise<void>;
  clearUnlock(childId: string): Promise<void>;
  /** Removes the profile and the child's user row (and with it their sessions and backup). */
  deleteChild(childId: string): Promise<void>;
}

export type Audience = 'all' | 'students' | 'parents' | 'children' | 'user';

export interface AnnouncementRecord {
  id: number;
  title: string;
  body: string;
  audience: Audience;
  createdAt: Date;
}

/** Admin messages shown as notifications on the phones. */
export interface AnnouncementsRepo {
  create(a: { title: string; body: string; audience: Audience; targetUserId?: string | null; createdBy: string }): Promise<AnnouncementRecord>;
  /** Messages for this user newer than [afterId] (and not older than [since]), oldest first, at most [limit]. */
  listFor(user: { id: string; role: Role }, afterId: number, since: Date, limit: number): Promise<AnnouncementRecord[]>;
}

export interface PlanPrices {
  /** Rupees per month shown for the Student plan. */
  student: number;
  /** Rupees per month shown for the Parent plan. */
  parent: number;
}

/** Display prices set in the admin panel (what Google Play charges is set in Play Console). */
export interface PlanPricesRepo {
  get(): Promise<PlanPrices>;
  set(prices: PlanPrices, updatedBy: string): Promise<void>;
}

export interface RecommendedApp {
  id: number;
  name: string;
  tagline: string;
  url: string;
  keywords: string[];
  active: boolean;
  hasLogo: boolean;
  /** Changes whenever the app is edited; used to refresh cached logos. */
  updatedAt: Date;
}

export interface AppLogo {
  type: string;
  bytes: Buffer;
  updatedAt: Date;
}

export interface NewRecommendedApp {
  name: string;
  tagline: string;
  url: string;
  keywords: string[];
  logo?: { type: string; bytes: Buffer };
  createdBy: string;
}

/** Apps the admin suggests to students. Logo bytes are kept apart so lists stay light. */
export interface RecommendedAppsRepo {
  list(): Promise<RecommendedApp[]>;
  get(id: number): Promise<RecommendedApp | null>;
  create(a: NewRecommendedApp): Promise<RecommendedApp>;
  update(id: number, patch: { name?: string; tagline?: string; url?: string; keywords?: string[]; active?: boolean; logo?: { type: string; bytes: Buffer } }): Promise<void>;
  remove(id: number): Promise<void>;
  getLogo(id: number): Promise<AppLogo | null>;
  /** Hand-assign an app to one student (shown to them whatever they typed). */
  assign(userId: string, appId: number, createdBy: string): Promise<void>;
  unassign(userId: string, appId: number): Promise<void>;
  /** App ids assigned to each of these users (users with none are absent from the map). */
  assignedFor(userIds: string[]): Promise<Map<string, number[]>>;
}


/** Key/value settings edited in the admin panel. Secret values are encrypted by the caller before they get here. */
export interface SettingsRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, isSecret: boolean, updatedBy: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PayAttempt {
  subscriptionId: string;
  userId: string;
  tier: 'student' | 'parent';
  amountPaise: number;
  trial: boolean;
}

export interface PaymentRecord {
  paymentId: string;
  userId: string | null;
  subscriptionId: string | null;
  tier: 'student' | 'parent' | null;
  amountPaise: number;
  currency: string;
  status: string;
  method: string | null;
  detail: string | null;
  phone: string | null;
  email: string | null;
  errorCode: string | null;
  errorText: string | null;
  createdAt: Date;
}

export interface PaymentsRepo {
  addAttempt(a: PayAttempt): Promise<void>;
  findAttempt(subscriptionId: string): Promise<PayAttempt | null>;
  /** Inserts or updates by payment id, keeping the earliest createdAt. */
  upsertPayment(p: PaymentRecord): Promise<void>;
  listForUser(userId: string, limit: number): Promise<PaymentRecord[]>;
  /** True the first time a webhook event id is seen. */
  recordEvent(eventId: string): Promise<boolean>;
}

export interface Repos {
  settings: SettingsRepo;
  payments: PaymentsRepo;
  recommendedApps: RecommendedAppsRepo;
  planPrices: PlanPricesRepo;
  announcements: AnnouncementsRepo;
  family: FamilyRepo;
  ai: AiRepo;
  auth: AuthRepo;
  users: UsersRepo;
  subscriptions: SubscriptionsRepo;
  backups: BackupsRepo;
}
