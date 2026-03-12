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
      {
        threshold: 0.2,
        rootMargin: "0px 0px -10% 0px"
      }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <main>
        <section className="section hero bg-cream">
          <div className="section-container max-w-4xl">
            <div className="hero-shell">
              <span className="badge">For self-directed stock investors</span>
              <h1 className="hero-headline">
                <span>You don't know</span>
                <span className="hero-italic">when to sell</span>
                <span>your stocks.</span>
              </h1>
              <p className="hero-kicker">Because you never had a plan when you bought them.</p>
              <div className="hero-body">
                <p className="body-standard subtle hero-summary">
                  Vanna is your personal investing caddie. It gives you a framework for every position, helps you make
                  decisions for the right reasons, and evolves with you as you grow.
                </p>
                <div className="cta-row">
                  <button type="button" className="btn-primary group" onClick={openModal}>
                    Join the waitlist
                    <span className="arrow">→</span>
                  </button>
                  <p className="small-text">Framework for every position.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-lined bg-white">
          <div className="section-container max-w-4xl">
            <div className="story-intro" data-reveal>
              <span className="eyebrow">The Problem</span>
              <h2 className="section-headline">Most investors do not have a framework for their decisions.</h2>
            </div>
            <div className="behavior-strip" data-reveal>
              <div className="behavior-step">
                <span className="behavior-number">01</span>
                <p className="body-standard">Buy on instinct.</p>
              </div>
              <div className="behavior-step">
                <span className="behavior-number">02</span>
                <p className="body-standard">Hold on hope.</p>
              </div>
              <div className="behavior-step">
                <span className="behavior-number">03</span>
                <p className="body-standard">Rewrite the story later.</p>
              </div>
            </div>
            <div className="story-grid" data-reveal>
              <p className="body-large">
                Without a real framework, every position becomes harder to judge once money and emotion get involved.
              </p>
            </div>
          </div>
        </section>

        <section className="section bg-cream">
          <div className="section-container max-w-4xl centered" data-reveal>
            <span className="eyebrow">Vanna</span>
            <h2 className="section-headline">Vanna gives you that framework.</h2>
            <p className="body-large">Your personal investing caddie.</p>
            <div className="promise-row">
              <p className="promise-item">Build a plan before you buy.</p>
              <p className="promise-item">Know what matters while you hold.</p>
              <p className="promise-item">Make clearer decisions over time.</p>
            </div>
            <p className="body-standard subtle">
              It will not tell you what to buy. It helps you understand your positions and make better decisions around them.
            </p>
          </div>
        </section>

        <section className="section final-cta">
          <div className="section-container max-w-3xl centered" data-reveal>
            <h2 className="section-headline light">Start investing with a framework.</h2>
            <p className="body-large light-subtle">
              Join the waitlist before your next position becomes another decision you cannot clearly explain.
            </p>
            <button type="button" className="btn-inverse group" onClick={openModal}>
              Join the waitlist
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
