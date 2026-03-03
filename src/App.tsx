import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

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

const WAITLIST_API_URL = import.meta.env.VITE_WAITLIST_API_URL?.trim();
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

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

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [email, setEmail] = useState("");
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

  const openModal = () => {
    setIsModalOpen(true);
    setErrorMessage("");
  };

  const closeModal = () => {
    setIsModalOpen(false);
    window.setTimeout(() => {
      setIsSuccess(false);
      setAlreadyJoined(false);
      setEmail("");
      setWebsite("");
      setErrorMessage("");
      setTurnstileToken("");
      setTurnstileReady(false);
      setIsSubmitting(false);
    }, 200);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || isSubmitting) return;
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
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email.trim(),
          website: website.trim(),
          turnstileToken,
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

      if (!response.ok) {
        throw new Error(payload.message || "Waitlist capture failed");
      }

      if (!payload.ok) {
        throw new Error(payload.message || "Unable to join waitlist.");
      }

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

  return (
    <>
      <main>
        <section className="section hero bg-cream">
          <div className="section-container max-w-4xl">
            <span className="badge">AI-Powered Investing Assistant</span>
            <h1 className="hero-headline">
              You don't know
              <br />
              <span className="italic">when to sell</span>
              <br />
              your stocks.
            </h1>
            <p className="body-large max-w-2xl">Because you never had a plan when you bought them.</p>
            <p className="body-standard subtle max-w-2xl">
              Our AI walks you through creating a real investment thesis, then monitors your portfolio and alerts you when
              things change. Stop investing on feelings. Start investing with a plan.
            </p>
            <div className="cta-row">
              <button type="button" className="btn-primary group" onClick={openModal}>
                Start 7-day free trial
                <span className="arrow">→</span>
              </button>
              <p className="small-text">Then $20/month</p>
            </div>
          </div>
        </section>

        <section className="section bg-white">
          <div className="section-container max-w-6xl">
            <h2 className="section-headline centered">How it works</h2>
            <p className="body-large subtle centered max-w-3xl">
              Your AI investing partner that helps you think clearly and stay disciplined
            </p>
            <div className="steps-grid">
              <article className="step">
                <span className="step-number">1</span>
                <h3 className="subsection-headline">When you buy</h3>
                <p className="body-standard">
                  AI asks the right questions: why this stock, what would make you sell, and how long you plan to hold.
                </p>
              </article>
              <article className="step">
                <span className="step-number">2</span>
                <h3 className="subsection-headline">While you hold</h3>
                <p className="body-standard">
                  The agent monitors news, earnings, and market conditions against your original thesis.
                </p>
              </article>
              <article className="step">
                <span className="step-number">3</span>
                <h3 className="subsection-headline">When conditions change</h3>
                <p className="body-standard">
                  You get clear alerts and check-ins so you can decide confidently without constant portfolio anxiety.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section bg-cream">
          <div className="section-container max-w-6xl">
            <h2 className="section-headline centered">What you get</h2>
            <div className="features-grid">
              <article className="feature-card">
                <div className="icon-box">
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <h3 className="subsection-headline">Guided thesis creation</h3>
                <p className="body-standard">Understand why you are investing and when you would sell before pressing buy.</p>
              </article>
              <article className="feature-card">
                <div className="icon-box">
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <h3 className="subsection-headline">Smart alerts</h3>
                <p className="body-standard">Get notified when events contradict your original investing reason.</p>
              </article>
              <article className="feature-card">
                <div className="icon-box">
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="subsection-headline">Portfolio check-ins</h3>
                <p className="body-standard">Simple updates on position size, rebalancing ideas, and risk exposure.</p>
              </article>
              <article className="feature-card">
                <div className="icon-box">
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                  </svg>
                </div>
                <h3 className="subsection-headline">Bull & bear analysis</h3>
                <p className="body-standard">See both sides before buying so you are not investing on hype alone.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section bg-white">
          <div className="section-container max-w-3xl centered">
            <h2 className="section-headline about-headline">Built by an investor who learned the hard way</h2>
            <p className="body-large">
              After working on AI systems at a hedge fund, I realized disciplined investing is not complicated, it is just
              consistent. This brings that structure to beginners without jargon.
            </p>
            <p className="body-standard subtle">No secrets. No insider tricks. Just better process and better decisions.</p>
          </div>
        </section>

        <section className="section final-cta">
          <div className="section-container max-w-3xl centered">
            <h2 className="section-headline light">Stop investing on feelings</h2>
            <p className="body-large light-subtle">Start your 7-day free trial. Then $20/month.</p>
            <button type="button" className="btn-inverse group" onClick={openModal}>
              Start free trial
              <span className="arrow">→</span>
            </button>
          </div>
        </section>
      </main>

      {isModalOpen ? (
        <div className="modal-overlay" role="presentation" onClick={closeModal}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Waitlist signup" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
              ×
            </button>
            {isSuccess ? (
              <div className="modal-success">
                <div className="success-icon-wrap">
                  <svg className="success-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="modal-title">You're on the list!</h3>
                <p className="body-standard subtle">
                  {alreadyJoined ? "You're already on the waitlist. We'll keep you posted." : "We'll email you when we launch."}
                </p>
              </div>
            ) : (
              <>
                <h3 className="modal-title">Coming soon</h3>
                <p className="body-standard subtle">
                  We are finishing the product now. Join the waitlist and you'll be one of the first to try it.
                </p>
                <form className="waitlist-form" onSubmit={handleSubmit}>
                  <div className="honeypot-wrap" aria-hidden="true">
                    <label htmlFor="website-field">Website</label>
                    <input
                      id="website-field"
                      name="website"
                      type="text"
                      autoComplete="off"
                      tabIndex={-1}
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                    />
                  </div>
                  <input
                    ref={inputRef}
                    type="email"
                    required
                    placeholder="Enter your email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="email-input"
                  />
                  {TURNSTILE_SITE_KEY ? (
                    <div className="turnstile-wrap">
                      <div ref={turnstileRef} />
                      {!turnstileReady ? <p className="small-text">Loading security check...</p> : null}
                    </div>
                  ) : null}
                  <button type="submit" className="btn-primary btn-full" disabled={isSubmitting}>
                    {isSubmitting ? "Joining..." : "Join waitlist"}
                  </button>
                </form>
                {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default App;
