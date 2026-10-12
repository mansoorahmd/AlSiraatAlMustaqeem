// The walkthrough — how to use MQ Research Gate, chapter by chapter, in the app itself.
//
// Written for the person reading it: each chapter says what something is for, how to reach it,
// and (where it can) takes you there with "Show me". It reads the LIVE account and plan
// features, so the locks it shows, and the "What your plan includes" table, are always what this
// account actually has — never a copy that can drift from the Admin settings.
//
// Open from the ? in the top bar, the Home card, or ⌘K → "Guide". The last chapter you read is
// remembered on this device only (a convenience; the guide works without it).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppDispatch, type Tab } from "../state/store";
import { useMe } from "../hooks/useMe";
import { remote, type RoleLevel } from "../api/remote";
import { useFeatureCatalog, type PlanFeature } from "../lib/features";
import { PlanLock } from "../components/PlanLock";
import { OPEN_ACCOUNT_EVENT } from "../components/CorpusAccessBanner";

const SEEN_KEY = "guide.chapter";
const remembered = (): string | null => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const remember = (id: string) => { try { localStorage.setItem(SEEN_KEY, id); } catch { /* private window */ } };

interface Chapter {
  id: string;
  title: string;
  /** one line under the title in the chapter list */
  blurb: string;
  /** features this chapter is about — a lock shows when the account lacks any of them */
  features?: PlanFeature[];
  maintainerOnly?: boolean;
  body: () => ReactNode;
  showMe?: { label: string; run: () => void };
}

/** A key or mark as the app draws it. */
const K = ({ children }: { children: ReactNode }) => <kbd className="guide-key">{children}</kbd>;

export function Guide() {
  const dispatch = useAppDispatch();
  const { me } = useMe();
  const catalog = useFeatureCatalog();
  const [roles, setRoles] = useState<RoleLevel[]>([]);
  useEffect(() => { remote.roles().then(setRoles).catch(() => {}); }, []);

  const isMaintainer = me?.role === "maintainer";
  const go = (tab: Tab) => () => dispatch({ type: "setTab", tab });
  const openPalette = () => window.dispatchEvent(new CustomEvent("open-palette"));
  const openAccount = () => window.dispatchEvent(new CustomEvent(OPEN_ACCOUNT_EVENT));
  const locked = (f: PlanFeature) => me?.features?.[f] === false;
  const planLabel = (p: string | null | undefined) =>
    p === null ? "Anyone" : p === "free" ? "Free" : p ? p.charAt(0).toUpperCase() + p.slice(1) : "…";

  const chapters: Chapter[] = useMemo(() => [
    {
      id: "welcome", title: "Welcome", blurb: "What the app is, and the two keys",
      body: () => (
        <>
          <p>MQ Research Gate is a place to study the Qur'an from its own words: read it, follow a root or a
            word through every place it occurs, weigh what the dictionaries say, and build your own reading,
            case by case.</p>
          <p>Two things decide what you can do, and they don't depend on each other:</p>
          <ul>
            <li><strong>Your role</strong> — what you may <em>do</em>: publish, review, run the system.
              Everyone starts as a <em>Reader</em>.</li>
            <li><strong>Your plan</strong> — which <em>features</em> you may use. Everyone starts on
              <em> Free</em>, which covers reading and studying the Book.</li>
          </ul>
          <p>Your own research — notes, indications, cases — is private to your account. Nothing is shared
            unless you publish it.</p>
          {me ? (
            <p className="guide-you">You're signed in as <strong>{me.displayName || me.email}</strong> —
              role <strong>{me.roleLabel || me.role}</strong>, plan <strong>{me.planLabel || me.plan}</strong>.
              Anything marked <PlanLock feature="notes" /> in this guide isn't in your plan yet.</p>
          ) : (
            <p className="guide-you">You aren't signed in. Reading needs a free account — the next chapter
              shows how.</p>
          )}
        </>
      ),
    },
    {
      id: "account", title: "Your account", blurb: "Sign up, sign in, upgrade",
      body: () => (
        <>
          <p>Open the account panel from <strong>Sign in</strong> (or your initials) at the top right.</p>
          <ol>
            <li><strong>Create an account</strong> — choose <em>New here? Create an account</em>, then give your
              email, a password (10 characters or more), your date of birth (your age is worked out from it),
              your region, and — if you wish — your gender. You're signed in straight away.</li>
            <li><strong>Sign in</strong> next time with the same email and password. Forgotten it? Type your
              email and choose <em>Email me a reset link</em>.</li>
            <li><strong>Have an invite code?</strong> Choose <em>Use it</em> — an invite can bring you in at a
              higher role.</li>
          </ol>
          <p>New accounts are <strong>Reader</strong> on the <strong>Free</strong> plan. A maintainer can move
            you to Pro (there's no online payment yet) or give you a higher role.</p>
        </>
      ),
      showMe: { label: "Open the account panel", run: openAccount },
    },
    {
      id: "read", title: "Reading", blurb: "Surahs, āyāt, scripts and translations",
      features: ["text", "translations"],
      body: () => (
        <>
          <p><strong>Read</strong> opens the list of surahs; <strong>Continue reading</strong> on Home takes you
            back to where you stopped. To jump anywhere, press <K>⌘K</K> / <K>Ctrl K</K> and type an āyah such as
            <em> 2:255</em>.</p>
          <p>Beside each āyah number are small marks. They appear only when they mean something:</p>
          <ul className="guide-marks">
            <li><K>✎</K> notes and questions on this āyah</li>
            <li><K>≡</K> a phrase in it is repeated elsewhere in the Book (echoes)</li>
            <li><K>✍</K> a word in it is written more than one way in the mushaf</li>
            <li><K>↻</K> a root repeats within the āyah</li>
            <li><K>⇋</K> add the āyah to your comparison</li>
            <li><K>⚖</K> the āyah is evidence in one of your cases</li>
          </ul>
          <p>The script, text size and translations are in <strong>Settings</strong> (<K>⚙</K>, top right). The
            round <K>☰</K> button in the reader jumps to a surah or āyah and sets the āyah lens.</p>
        </>
      ),
      showMe: { label: "Go to Read", run: go("read") },
    },
    {
      id: "word", title: "A word, its root and meaning", blurb: "Tap any word",
      features: ["roots", "meanings", "wazn", "spelling"],
      body: () => (
        <>
          <p>Tap any word while reading. Its menu shows:</p>
          <ul>
            <li><strong>The root</strong> and how often it occurs in the Book — tap it for the root's own page
              (also under <em>Study → Roots</em>): every form, every occurrence and the roots it keeps company with.</li>
            <li><strong>Root core</strong> — the root's meaning in brief, and <K>📖 Lexicons</K> — what the
              classical dictionaries say.</li>
            <li><strong>صرف</strong> — the word's pattern (wazn), and <K>✍ written N ways</K> when the same word
              is spelled differently elsewhere.</li>
          </ul>
          <p>From the same menu you can follow the root or the word, pin it to an expression search, or — with
            Pro — add a note, an indication, or open a case.</p>
        </>
      ),
      showMe: { label: "Go to Read", run: go("read") },
    },
    {
      id: "trails", title: "Following a thread", blurb: "Walk a root or a word through the Book",
      features: ["follow-root", "follow-word"],
      body: () => (
        <>
          <p>In a word's menu choose <K>➶ Follow root</K> to walk every form of its root, occurrence by
            occurrence — or <K>➶ Follow this word</K> for only this exact spelling (the only thread for
            particles and names).</p>
          <p>The <strong>trail bar</strong> at the bottom shows where you are (for example <em>65 / 68</em>):</p>
          <ul>
            <li><K>‹</K> <K>›</K> step to the previous or next occurrence — the word is highlighted in place;</li>
            <li>the strip below maps the whole thread; each dot is an occurrence you've visited — click one to
              go back to it;</li>
            <li><K>promote to case</K> turns the thread into a case (Pro); <K>end trail</K> closes it — the
              trail is kept.</li>
          </ul>
          <p>Your trails are listed under <strong>Recent trails</strong> on Home; clicking one picks up at the
            last occurrence you reached.</p>
        </>
      ),
      showMe: { label: "See your recent trails", run: go("home") },
    },
    {
      id: "tools", title: "Search and study tools", blurb: "Search, echoes, compare, the lens",
      features: ["search", "echoes", "similar", "linkages", "lens", "compare"],
      body: () => (
        <>
          <ul>
            <li><strong>Search</strong> — <K>⌘K</K> finds āyāt, roots and your cases as you type; choose
              <em> Search the Book</em> for the full search (also <em>Advanced search</em>).
              <K>⊕ Expression</K> in a word's menu finds āyāt where words occur together.</li>
            <li><strong>Echoes</strong> <K>≡</K> — open the panel on an āyah to see where its phrase recurs.</li>
            <li><strong>Similar āyāt</strong> — āyāt that resemble one another: in an āyah case's evidence drawer,
              and in the āyah lens.</li>
            <li><strong>Where roots meet</strong> — on a root's page, the roots it keeps company with; pick one to
              see the āyāt where both occur.</li>
            <li><strong>Āyah lens</strong> — in the reader's <K>☰</K> menu, focus an āyah (or a case) and the
              reader marks what connects to it.</li>
            <li><strong>Compare</strong> — <K>⇋</K> adds an āyah, a form or a root to a comparison;
              <em> Study → Compare</em> sets them side by side.</li>
          </ul>
        </>
      ),
      showMe: { label: "Open search (⌘K)", run: openPalette },
    },
    {
      id: "study", title: "Your own study", blurb: "Notes, indications, meanings, motifs",
      features: ["notes", "indications", "my-meanings", "motifs"],
      body: () => (
        <>
          <ul>
            <li><strong>Notes & questions</strong> — <K>✎</K> on an āyah, or <em>Note</em> in a word's menu. Open
              questions are counted on Home until you answer them.</li>
            <li><strong>Indications</strong> — <K>✒ Indications</K> in a word's menu: name what the root
              indicates, mark one as primary (your default gloss), and give each form its own shade. Turn on
              <em> My gloss</em> in Settings to see them under the words.</li>
            <li><strong>My meaning</strong> — on a root's page, your own understanding beside the dictionaries.</li>
            <li><strong>Motifs</strong> (بيوت) — group roots that belong together (<em>Study → Motifs</em>).</li>
            <li><strong>Vault</strong> — the roots you've established (<em>Study → Vault</em>).</li>
          </ul>
          <p>These need the Pro plan. Without it they're <strong>read-only</strong>: anything you've already
            made stays visible, but you can't add or change it.</p>
        </>
      ),
      showMe: { label: "Open the Vault", run: go("vault") },
    },
    {
      id: "research", title: "Cases and publishing", blurb: "Investigate, share, the community",
      features: ["cases", "publish", "community", "divergences"],
      body: () => (
        <>
          <ul>
            <li><strong>Cases</strong> — open one from a word's menu (<K>⚖ Open a case</K> on its root,
              <K> ⚖ Case on</K> an āyah) or <K>＋ new</K> on Home for a phrase or theme. <em>Investigate</em> is the
              board: gather āyāt as evidence, link and group them, reach a conclusion, and export the case.</li>
            <li><strong>Publish</strong> — <K>↑</K> sends a note or a reading to the community for review. It
              needs the Pro plan <em>and</em> a role that may publish (Researcher by default). A moderator
              reviews it; nobody approves their own work.</li>
            <li><strong>Community readings</strong> — the group's established readings appear (marked ◈) beside
              yours in a word's menu.</li>
            <li><strong>Where I stand apart</strong> — <em>Study</em>: forms where your reading and the group's
              differ.</li>
          </ul>
        </>
      ),
      showMe: { label: "Go to Investigate", run: go("investigate") },
    },
    {
      id: "ai", title: "Your AI assistant", blurb: "Study with Claude",
      features: ["ai"],
      body: () => (
        <>
          <p>Connect Claude (or another AI app) to study the Book with you. It reads the corpus and your
            research <em>as you</em> — exactly what your plan allows.</p>
          <ol>
            <li>Open the account panel → <strong>Connect an AI assistant</strong>, name it, and
              <em> Create token</em>.</li>
            <li><strong>Claude app</strong> (desktop or claude.ai): Settings → Connectors → Add custom connector,
              and paste the URL shown. <strong>Claude Code, Cursor and others</strong>: paste the config shown.</li>
            <li>The token is shown once — keep it like a password. <em>Revoke</em> cuts the assistant off at once.</li>
          </ol>
          <p>The assistant can read and <strong>suggest</strong> — its notes and indications arrive marked
            <em> AI</em> for you to accept. It can never publish, review, or change the Admin settings.</p>
        </>
      ),
      showMe: { label: "Open the account panel", run: openAccount },
    },
    {
      id: "plans", title: "What your plan includes", blurb: "Every feature, live",
      body: () => (
        <>
          <p>Every feature has its own setting, chosen by a maintainer. This is what applies right now
            {me ? <> — a <K>✓</K> is in your plan</> : null}.</p>
          {!catalog && <p className="loading">Loading…</p>}
          {catalog?.groups.map((g) => (
            <div key={g.key} className="guide-plan-group">
              <h4>{g.label}</h4>
              <ul className="guide-plan-list">
                {catalog.features.filter((f) => f.group === g.key).map((f) => (
                  <li key={f.key}>
                    <span className="guide-plan-name">{f.label}
                      <span className="guide-plan-desc">{f.description}</span></span>
                    <span className="guide-plan-min">{planLabel(f.minPlan)}</span>
                    {me && <span className="guide-plan-you">{locked(f.key) ? <PlanLock feature={f.key} /> : "✓"}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <h4>Roles, lowest first</h4>
          <p className="guide-roles">{roles.length ? roles.map((r) => r.label || r.name).join(" → ") : "…"}</p>
          <p>Each role can do everything the roles below it can. Publishing needs Researcher by default;
            reviewing needs Moderator; running the system needs Maintainer.</p>
        </>
      ),
    },
    {
      id: "admin", title: "For maintainers", blurb: "People, plans and features", maintainerOnly: true,
      body: () => (
        <>
          <p>The <strong>Admin</strong> tab (maintainers only) runs the community. Changes apply at once.</p>
          <ul>
            <li><strong>People</strong> — everyone with their role, plan, region, age and join date. Choose
              <em> Change</em> to move someone to Pro (optionally for a number of days) or to another role.
              New sign-ups arrive as Reader · Free.</li>
            <li><strong>What each plan may use</strong> — every feature in its group. Set one feature, or a whole
              group at once, to <em>Anyone</em>, <em>Any signed-in account</em> or a plan. A locked tool is refused;
              locked personal features turn read-only.</li>
            <li><strong>Plan tiers</strong> — add plans such as <em>Scholar</em> between Free and Pro; they
              appear as choices everywhere.</li>
            <li><strong>Roles</strong> — add, rename or reorder learner roles between Reader and Moderator, and
              choose which role may publish.</li>
            <li><strong>Translations & dictionaries</strong> — lock a single one to a higher plan.</li>
            <li><strong>Invites</strong> — in your account panel: an invite code brings someone in at a role you choose.</li>
          </ul>
        </>
      ),
      showMe: { label: "Go to Admin", run: go("admin") },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [me, catalog, roles]);

  const shown = chapters.filter((c) => !c.maintainerOnly || isMaintainer);
  const [current, setCurrent] = useState<string>(() => remembered() ?? "welcome");
  const idx = Math.max(0, shown.findIndex((c) => c.id === current));
  const chapter = shown[idx]!;
  const open = (id: string) => { setCurrent(id); remember(id); window.scrollTo({ top: 0 }); };
  const lockedHere = (chapter.features ?? []).filter(locked);

  return (
    <div className="sheet home guide">
      <header className="home-hero">
        <h1 className="admin-title">Guide</h1>
        <p className="acct-hint">A walkthrough of MQ Research Gate — read it in order, or jump to any chapter.</p>
      </header>

      <div className="guide-layout">
        <nav className="guide-toc" aria-label="Chapters">
          <ol>
            {shown.map((c, i) => (
              <li key={c.id}>
                <button className={`guide-toc-item${c.id === chapter.id ? " active" : ""}`}
                  aria-current={c.id === chapter.id ? "step" : undefined} onClick={() => open(c.id)}>
                  <span className="guide-toc-num">{i + 1}</span>
                  <span className="guide-toc-text">
                    <span className="guide-toc-title">{c.title}
                      {(c.features ?? []).some(locked) && <> <PlanLock feature={(c.features ?? []).find(locked)!} /></>}
                    </span>
                    <span className="guide-toc-blurb">{c.blurb}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="home-card guide-chapter">
          <p className="guide-step">Chapter {idx + 1} of {shown.length}</p>
          <h2 className="guide-title">{chapter.title}</h2>
          {lockedHere.length > 0 && (
            <p className="plan-readonly-note">
              <PlanLock feature={lockedHere[0]!} /> Some of this isn't in your plan yet — a maintainer can upgrade
              your account.
            </p>
          )}
          <div className="guide-body">{chapter.body()}</div>

          <footer className="guide-foot">
            <button className="ctl" disabled={idx === 0} onClick={() => open(shown[idx - 1]!.id)}>← Back</button>
            {chapter.showMe && (
              <button className="ctl" onClick={chapter.showMe.run}>{chapter.showMe.label}</button>
            )}
            {idx < shown.length - 1 ? (
              <button className="ctl primary" onClick={() => open(shown[idx + 1]!.id)}>Next: {shown[idx + 1]!.title} →</button>
            ) : (
              <button className="ctl primary" onClick={go("read")}>Start reading →</button>
            )}
          </footer>
        </article>
      </div>
    </div>
  );
}
