import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./index.css";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        }
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

type WaitlistResponse = {
  ok?: boolean;
  alreadyJoined?: boolean;
  message?: string;
};

type WaitlistPersona = "individual" | "advisor_enterprise";

type DemoFrame =
  | { type: "user"; text: string; delay: number }
  | { type: "vanna"; text: string; delay: number };

type PortfolioRow = {
  holding: string;
  why: string;
  understands: string;
};

const WAITLIST_API_URL = import.meta.env.VITE_WAITLIST_API_URL?.trim();
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const DEMO_FRAMES: DemoFrame[] = [
  {
    type: "user",
    text: "Hey, I saw AMD is getting more serious about AI chips, and I'm thinking about adding it. I know they mostly make CPUs, but it feels like they could really come up here.",
    delay: 1100
  },
  {
    type: "vanna",
    text: "That makes sense. But looking at your portfolio, this would push you further into the same AI bet you already have. You already own Nvidia and TSMC, so adding AMD isn't really new exposure unless there's something specific about AMD that you think you can't get from those two.",
    delay: 2500
  },
  {
    type: "user",
    text: "Hmm, okay, that makes sense. But I feel like AMD kind of gives me more exposure to the space. Like, if Nvidia starts losing ground, AMD is probably one of the names that benefits from that, right?",
    delay: 1150
  },
  {
    type: "vanna",
    text: "Okay, that makes sense. One thing I'm picking up, though, is that even if Nvidia starts losing some ground and AMD picks up some of that upside, the market may already be expecting part of that. So the better question is: what is actually special about AMD here that could matter more than people expect right now? If you want, we can make that more concrete and break down the real case for AMD before you decide how you want to play it.",
    delay: 2900
  }
];

const DEMO_RESTART_DELAY_MS = 2600;
const DEMO_FINAL_HOLD_MS = 4200;

const PERSONA_OPTIONS: Array<{
  value: WaitlistPersona;
  label: string;
  detail: string;
}> = [
  {
    value: "individual",
    label: "I invest my own capital",
    detail: "Personal portfolio and investing decisions."
  },
  {
    value: "advisor_enterprise",
    label: "I manage capital for others",
    detail: "Client capital, books of exposure, and enterprise workflows."
  }
];

const SAMPLE_PORTFOLIO: PortfolioRow[] = [
  {
    holding: "Nvidia",
    why: "You see Nvidia as the clearest way to own the backbone of the AI buildout.",
    understands: "You build conviction around the company most essential to a structural shift."
  },
  {
    holding: "Microsoft",
    why: "You want exposure to the same shift through a durable business with enterprise reach.",
    understands: "You prefer upside inside a proven platform, not a fragile story."
  },
  {
    holding: "AMD",
    why: "You see AMD as a second expression of the same core AI belief behind Nvidia.",
    understands: "When a thesis feels right, you reinforce it through related names you understand."
  },
  {
    holding: "Amazon",
    why: "You want exposure through cloud, scale, and a business that benefits as adoption deepens.",
    understands: "You are drawn to platforms that matter more as the long-term shift becomes real."
  }
];

const SAMPLE_PRINCIPLES = [
  "You trust structural importance more than short-term excitement.",
  "You prefer businesses with real staying power, not just narrative momentum.",
  "When a thesis proves itself, you like building around it through multiple expressions that still fit your logic."
];

function getEmailValidationMessage(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email) return "Please enter your email address.";
  if (email.length > 320) return "Email addresses must be 320 characters or fewer.";
  if (/\s/.test(email)) return "Please enter a valid email address.";

  const parts = email.split("@");
  if (parts.length !== 2) return "Please enter a valid email address.";

  const [localPart, domain] = parts;
  if (!localPart || !domain) return "Please enter a valid email address.";
  if (localPart.length > 64 || domain.length > 255) return "Please enter a valid email address.";
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return "Please enter a valid email address.";
  }

  return "";
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Turnstile script")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });
}

function readUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get("utm_source") || "";
  const utmMedium = params.get("utm_medium") || "";
  const utmCampaign = params.get("utm_campaign") || "";
  const utmContent = params.get("utm_content") || "";
  const utmTerm = params.get("utm_term") || "";
  const referral = params.get("ref") || params.get("referral") || "";

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    referral
  };
}

function renderBubbleText(text: string) {
  return text.split("\n\n").map((paragraph, index) => (
    <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
  ));
}

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [persona, setPersona] = useState<WaitlistPersona | "">("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [website, setWebsite] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const utmParamsRef = useRef<Record<string, string>>(readUtmParams());

  const [demoStep, setDemoStep] = useState(-1);
  const [demoRunId, setDemoRunId] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const demoRef = useRef<HTMLDivElement | null>(null);
  const demoBodyRef = useRef<HTMLDivElement | null>(null);

  const openModal = (nextPersona?: WaitlistPersona) => {
    setIsModalOpen(true);
    setPersona(nextPersona ?? "");
    setErrorMessage("");
    setEmailError("");
    setEmailTouched(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    window.setTimeout(() => {
      setIsSuccess(false);
      setAlreadyJoined(false);
      setPersona("");
      setEmail("");
      setEmailError("");
      setEmailTouched(false);
      setWebsite("");
      setErrorMessage("");
      setTurnstileToken("");
      setTurnstileReady(false);
      setIsSubmitting(false);
    }, 300);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!persona) {
      setErrorMessage("Please choose how you plan to use Vanna.");
      return;
    }

    const validationMessage = getEmailValidationMessage(email);
    setEmailTouched(true);
    setEmailError(validationMessage);
    if (validationMessage) return;

    if (!WAITLIST_API_URL) {
      setErrorMessage("Waitlist is not configured yet. Add VITE_WAITLIST_API_URL and try again.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setErrorMessage("Please complete the security check.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch(WAITLIST_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          website: website.trim(),
          turnstileToken,
          persona,
          source: utmParamsRef.current.utmSource || "website",
          ...utmParamsRef.current
        })
      });

      let payload: WaitlistResponse = {};
      try {
        payload = (await response.json()) as WaitlistResponse;
      } catch {
        payload = {};
      }

      if (!response.ok) throw new Error(payload.message || "Waitlist capture failed");
      if (!payload.ok) throw new Error(payload.message || "Unable to join waitlist.");

      setAlreadyJoined(Boolean(payload.alreadyJoined));
      setIsSuccess(true);
      window.setTimeout(() => {
        closeModal();
      }, 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      setErrorMessage(message);
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
        setTurnstileToken("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (!emailTouched) return;
    setEmailError(getEmailValidationMessage(value));
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    setEmailError(getEmailValidationMessage(email));
  };

  useEffect(() => {
    if (!isModalOpen) return;
    inputRef.current?.focus();
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen || !TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    const mountTurnstile = async () => {
      try {
        await loadTurnstileScript();
        if (cancelled || !window.turnstile || !turnstileRef.current || turnstileWidgetIdRef.current) return;
        const widgetId = window.turnstile.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "light",
          callback: (token: string) => {
            setTurnstileToken(token);
            setErrorMessage("");
          },
          "expired-callback": () => {
            setTurnstileToken("");
          },
          "error-callback": () => {
            setTurnstileToken("");
            setErrorMessage("Security check failed. Please retry.");
          }
        });
        turnstileWidgetIdRef.current = widgetId;
        setTurnstileReady(true);
      } catch {
        setErrorMessage("Unable to load security check. Refresh and try again.");
      }
    };
    void mountTurnstile();
    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
      turnstileWidgetIdRef.current = null;
      setTurnstileReady(false);
      setTurnstileToken("");
    };
  }, [isModalOpen]);

  useEffect(() => {
    const chatBody = demoBodyRef.current;
    if (!chatBody) return;

    if (demoStep < 0) {
      chatBody.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      chatBody.scrollTo({
        top: chatBody.scrollHeight,
        behavior: demoStep < 1 ? "auto" : "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [demoRunId, demoStep]);

  useEffect(() => {
    const el = demoRef.current;
    if (!el) return;

    let running = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers.length = 0;
    }

    function run() {
      if (running) return;
      running = true;

      let elapsed = 600;
      DEMO_FRAMES.forEach((frame, index) => {
        if (frame.type === "vanna") {
          const typeDelay = 800;
          const typingTimer = setTimeout(() => setIsTyping(true), elapsed - typeDelay);
          const stopTypingTimer = setTimeout(() => setIsTyping(false), elapsed);
          timers.push(typingTimer, stopTypingTimer);
        }

        const frameTimer = setTimeout(() => setDemoStep(index), elapsed);
        timers.push(frameTimer);
        elapsed += frame.delay;
      });

      const fadeTimer = setTimeout(() => setIsResetting(true), elapsed + DEMO_FINAL_HOLD_MS - 1000);
      timers.push(fadeTimer);

      const restartTimer = setTimeout(() => {
        running = false;
        setDemoRunId((id) => id + 1);
        setDemoStep(-1);
        setIsResetting(false);
        setIsTyping(false);
        clearTimers();
        const resumeTimer = setTimeout(run, DEMO_RESTART_DELAY_MS);
        timers.push(resumeTimer);
      }, elapsed + DEMO_FINAL_HOLD_MS);
      timers.push(restartTimer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !running) run();
      },
      { threshold: 0.25 }
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      clearTimers();
      running = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -15% 0px" }
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <main className="v-main">
        <nav className="v-nav">
          <div className="v-logo">Vanna</div>
          <button className="v-btn-outline" onClick={() => openModal()}>
            Request Early Access
          </button>
        </nav>

        <section className="v-hero">
          <div className="v-hero-content">
            <h1 className="v-hero-title title-reveal">
              <span className="line-mask">
                <span>Understand how you invest.</span>
              </span>
              <span className="line-mask">
                <span>Build judgment that scales.</span>
              </span>
            </h1>
            <p className="v-hero-sub sub-reveal">
              Vanna helps you see your patterns, sharpen your reasoning, and make better portfolio
              decisions over time.
            </p>
            <div className="v-hero-cta sub-reveal delay-cta">
              <button className="v-btn-primary" onClick={() => openModal()}>
                Request Early Access
              </button>
            </div>
          </div>
          <div className="v-glow-orb"></div>
        </section>

        <section className="v-proof-section">
          <div className="v-proof-intro" data-reveal>
            <span className="v-tag">What Vanna Gives You</span>
            <h2 className="v-h2">A clearer picture of how you invest.</h2>
            <p className="v-p">
              A live picture of how you invest, what has been working in your decision-making, and
              where your conviction is taking shape.
            </p>
            <p className="v-proof-line">Understand your patterns. Build better theses. Scale better judgment.</p>
          </div>

          <div className="v-proof-card" data-reveal>
            <section className="v-proof-panel v-proof-table-panel" aria-labelledby="portfolio-title">
              <div className="v-proof-kicker">Sample Investor Profile</div>
              <h3 className="v-proof-title" id="portfolio-title">
                Current Portfolio
              </h3>
              <table className="v-proof-table">
                <thead>
                  <tr>
                    <th scope="col">Holding</th>
                    <th scope="col">Why you own it</th>
                    <th scope="col">What Vanna understands</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_PORTFOLIO.map((row) => (
                    <tr key={row.holding}>
                      <td data-label="Holding" className="v-proof-holding">
                        {row.holding}
                      </td>
                      <td data-label="Why you own it">{row.why}</td>
                      <td data-label="What Vanna understands">{row.understands}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <div className="v-proof-insights-grid">
              <section className="v-proof-block" aria-labelledby="pattern-title">
                <div className="v-proof-kicker">Your current pattern</div>
                <h3 className="v-proof-title" id="pattern-title">
                  Conviction built around durable shifts
                </h3>
                <p>
                  You invest best when the opportunity feels foundational, not temporary. You are
                  drawn to businesses that sit close to the core of a major shift, and you like
                  ideas where the logic stays intact even as the expression changes.
                </p>
              </section>

              <section className="v-proof-block" aria-labelledby="principles-title">
                <div className="v-proof-kicker">Principles Vanna has learned</div>
                <h3 className="v-proof-title" id="principles-title">
                  The logic behind your strongest decisions
                </h3>
                <ul className="v-proof-principles">
                  {SAMPLE_PRINCIPLES.map((principle) => (
                    <li key={principle}>{principle}</li>
                  ))}
                </ul>
              </section>

              <section className="v-proof-block" aria-labelledby="meaning-title">
                <div className="v-proof-kicker">What this means now</div>
                <h3 className="v-proof-title" id="meaning-title">
                  Vanna makes your conviction legible
                </h3>
                <p>
                  Vanna shows why a position belongs in your portfolio, how it connects to the
                  beliefs already driving your strongest decisions, and what kind of pattern you
                  are reinforcing when you add something new.
                </p>
              </section>
            </div>
          </div>
        </section>

        <section className="v-tabs-section">
          <div className="v-showcase-text" data-reveal>
            <span className="v-tag">How Vanna Gets There</span>
            <h2 className="v-h2">See the reasoning happen.</h2>
            <p className="v-p">
              The conversation is the evidence trail. Vanna challenges the idea, compares it to
              what you already own, and helps surface whether you are refining a thesis or just
              crowding into the same bet.
            </p>
          </div>

          <div className="v-chatshell-mock" ref={demoRef} style={{ position: "relative", zIndex: 2 }} data-reveal>
            <div className="vc-header">
              <div className="vc-dots">
                <span className="vc-dot red"></span>
                <span className="vc-dot yellow"></span>
                <span className="vc-dot green"></span>
              </div>
              <div className="vc-title">Vanna</div>
            </div>
            <div className={`vc-demo-stage ${isResetting ? "chat-fade-out" : ""}`} key={demoRunId}>
              <div className="vc-body-demo" ref={demoBodyRef}>
                {DEMO_FRAMES.slice(0, demoStep + 1).map((frame, index) => {
                  if (frame.type === "user") {
                    return (
                      <div key={index} className="vc-msg user">
                        <div className="vc-bubble">{renderBubbleText(frame.text)}</div>
                      </div>
                    );
                  }
                  return (
                    <div key={index} className="vc-msg system">
                      <div className="vc-avatar">V</div>
                      <div className="vc-bubble">{renderBubbleText(frame.text)}</div>
                    </div>
                  );
                })}
              </div>

              <div className={`vc-typing-slot${isTyping ? " is-visible" : ""}`} aria-hidden={!isTyping}>
                <div className="vc-msg system vc-typing">
                  <div className="vc-avatar">V</div>
                  <div className="vc-bubble">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            </div>
            <div className="vc-footer">
              <div className="vc-input-ghost">What are you trying to understand about this decision?</div>
            </div>
          </div>

          <div className="v-glow-orb" style={{ opacity: 0.15, zIndex: 0, width: "60vw", height: "60vw", top: "50%" }}></div>
        </section>

        <section className="v-enterprise-section">
          <div className="v-enterprise-card" data-reveal>
            <div className="v-enterprise-copy">
              <span className="v-tag">For Advisors And Firms</span>
              <h3 className="v-enterprise-title">The same intelligence, applied across client capital.</h3>
              <p className="v-p">
                Vanna Enterprise extends the same pattern recognition and judgment framework to
                advisors and firms managing other people&apos;s money.
              </p>
            </div>
            <button className="v-btn-outline" onClick={() => openModal("advisor_enterprise")}>
              Looking for enterprise access?
            </button>
          </div>
        </section>

        <footer className="v-footer">
          <div className="v-footer-content" data-reveal>
            <h2 className="v-footer-title">Better investing starts with better self-understanding.</h2>
            <p className="v-footer-sub">
              Join the waitlist for Vanna, the system that turns patterns into judgment and
              judgment into better portfolio decisions.
            </p>
            <button className="v-btn-primary large" onClick={() => openModal()}>
              Request Early Access
            </button>
          </div>
          <div className="v-watermark">VANNA</div>
        </footer>
      </main>

      {isModalOpen && (
        <div className="v-modal-overlay" role="presentation" onClick={closeModal}>
          <div
            className="v-modal-card fade-in"
            role="dialog"
            aria-modal="true"
            aria-label="Waitlist signup"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="v-modal-close" onClick={closeModal} aria-label="Close">
              ×
            </button>
            {isSuccess ? (
              <div className="v-modal-success">
                <div className="v-success-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="v-modal-h3">You&apos;re on the list!</h3>
                <p className="v-modal-p">
                  {alreadyJoined
                    ? "You're already on the waitlist. We'll keep you posted."
                    : "We'll reach out when the next cohort opens."}
                </p>
              </div>
            ) : (
              <>
                <h3 className="v-modal-h3">Request Early Access</h3>
                <p className="v-modal-p">
                  Join the waitlist for early access to Vanna. We&apos;re onboarding in small
                  cohorts as we refine the system.
                </p>
                <form className="v-form" onSubmit={handleSubmit}>
                  <div className="v-honeypot" aria-hidden="true">
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                    />
                  </div>

                  <fieldset className="v-persona-fieldset">
                    <legend className="v-persona-legend">How do you plan to use Vanna?</legend>
                    <div className="v-persona-group" role="radiogroup" aria-label="How do you plan to use Vanna?">
                      {PERSONA_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`v-persona-option${persona === option.value ? " is-selected" : ""}`}
                          aria-pressed={persona === option.value}
                          onClick={() => {
                            setPersona(option.value);
                            setErrorMessage("");
                          }}
                        >
                          <span className="v-persona-label">{option.label}</span>
                          <span className="v-persona-detail">{option.detail}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <input
                    ref={inputRef}
                    type="email"
                    required
                    placeholder="name@example.com"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    aria-invalid={emailTouched && Boolean(emailError)}
                    value={email}
                    onChange={(event) => handleEmailChange(event.target.value)}
                    onBlur={handleEmailBlur}
                    className={`v-input${emailTouched && emailError ? " is-invalid" : ""}`}
                  />
                  {emailTouched && emailError && <p className="v-field-error">{emailError}</p>}

                  {TURNSTILE_SITE_KEY && (
                    <div className="v-turnstile-wrap">
                      <div ref={turnstileRef} />
                      {!turnstileReady && <p className="v-small">Securing connection...</p>}
                    </div>
                  )}

                  <button type="submit" className="v-btn-primary full" disabled={isSubmitting}>
                    {isSubmitting ? "Processing..." : "Request Access"}
                  </button>
                  {errorMessage && <p className="v-error">{errorMessage}</p>}
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
