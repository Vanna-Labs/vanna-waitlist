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

const WAITLIST_API_URL = import.meta.env.VITE_WAITLIST_API_URL?.trim();
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function getEmailValidationMessage(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email) return "Please enter your email address.";
  if (email.length > 320) return "Email addresses must be 320 characters or fewer.";

  const parts = email.split("@");
  if (parts.length !== 2) return "Please enter a valid email address.";

  const [localPart, domain] = parts;
  if (!localPart || !domain) return "Please enter a valid email address.";
  if (localPart.length > 64 || domain.length > 255) return "Please enter a valid email address.";
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) {
    return "Please enter a valid email address.";
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) {
    return "Please enter a valid email address.";
  }

  const labels = domain.split(".");
  if (labels.length < 2) return "Please enter a valid email address.";
  if (labels[labels.length - 1]!.length < 2) return "Please enter a valid email address.";

  const hasInvalidDomainLabel = labels.some((label) => {
    if (!label || label.length > 63) return true;
    if (label.startsWith("-") || label.endsWith("-")) return true;
    return !/^[a-z0-9-]+$/i.test(label);
  });

  return hasInvalidDomainLabel ? "Please enter a valid email address." : "";
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
type DemoFrame =
  | { type: "user"; text: string; delay: number }
  | { type: "vanna"; text: string; delay: number };

const DEMO_FRAMES: DemoFrame[] = [
  { type: "user",      text: "I'm thinking about buying Nvidia. AI is everywhere right now and they're basically the backbone of all of it.", delay: 1000 },
  { type: "vanna",     text: "This actually fits a pattern you've been strong on. Your best trades have been infrastructure enablers, not application-layer bets. AMD and Microsoft followed the same logic and both worked. What would tell you the thesis broke here? If data center revenue growth slowed below a certain rate?", delay: 2600 },
  { type: "user",      text: "Yeah. If growth dropped below 20% year over year I'd reevaluate.", delay: 1200 },
  { type: "vanna",     text: "Got it. I'll track that and flag it if it gets close. One thing worth seeing: with what you already own, most of your portfolio is already riding the AI infrastructure thesis. Nvidia may still make sense, but it probably means sizing carefully instead of pressing the same bet too hard. Want to think through sizing?", delay: 3000 },
];
const DEMO_RESTART_DELAY_MS = 2800;
const DEMO_FINAL_HOLD_MS = 5000;

function renderBubbleText(text: string) {
  return text.split("\n\n").map((paragraph, index) => (
    <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
  ));
}

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  const openModal = () => {
    setIsModalOpen(true);
    setErrorMessage("");
    setEmailError("");
    setEmailTouched(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    window.setTimeout(() => {
      setIsSuccess(false);
      setAlreadyJoined(false);
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
          source: utmParamsRef.current.utmSource || "website",
          ...utmParamsRef.current
        })
      });

      let payload: WaitlistResponse = {};
      try { payload = (await response.json()) as WaitlistResponse; } catch { payload = {}; }

      if (!response.ok) throw new Error(payload.message || "Waitlist capture failed");
      if (!payload.ok) throw new Error(payload.message || "Unable to join waitlist.");

      setAlreadyJoined(Boolean(payload.alreadyJoined));
      setIsSuccess(true);
      window.setTimeout(() => { closeModal(); }, 3000);
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
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeModal(); };
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
          callback: (token: string) => { setTurnstileToken(token); setErrorMessage(""); },
          "expired-callback": () => { setTurnstileToken(""); },
          "error-callback": () => { setTurnstileToken(""); setErrorMessage("Security check failed. Please retry."); }
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
      if (turnstileWidgetIdRef.current && window.turnstile) { window.turnstile.remove(turnstileWidgetIdRef.current); }
      turnstileWidgetIdRef.current = null;
      setTurnstileReady(false);
      setTurnstileToken("");
    };
  }, [isModalOpen]);

  // Keep scrolling scoped to the chat pane so the page never gets pulled past the section.
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
  }, [demoRunId, demoStep, isTyping]);

  // Cinematic demo driver — starts when the section scrolls into view, loops forever
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
      DEMO_FRAMES.forEach((frame, i) => {
        // If it's Vanna responding, show typing first
        if (frame.type === "vanna") {
          const typeDelay = 800; // time spent typing
          const tTyping = setTimeout(() => setIsTyping(true), elapsed - typeDelay);
          const tStopTyping = setTimeout(() => setIsTyping(false), elapsed);
          timers.push(tTyping, tStopTyping);
        }

        const t = setTimeout(() => setDemoStep(i), elapsed);
        timers.push(t);
        elapsed += frame.delay;
      });

      // Prepare reset animation
      const tFade = setTimeout(() => setIsResetting(true), elapsed + DEMO_FINAL_HOLD_MS - 1000);
      timers.push(tFade);

      const restartTimer = setTimeout(() => {
        running = false;
        setDemoRunId(id => id + 1);
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
      (entries) => { if (entries[0]?.isIntersecting && !running) run(); },
      { threshold: 0.25 }
    );
    observer.observe(el);

    return () => { observer.disconnect(); clearTimers(); running = false; };
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
        {/* Navigation */}
        <nav className="v-nav">
          <div className="v-logo">Vanna</div>
          <button className="v-btn-outline" onClick={openModal}>Early Access</button>
        </nav>

        {/* Hero Section */}
        <section className="v-hero">
          <div className="v-hero-content">
            <h1 className="v-hero-title title-reveal">
              <span className="line-mask"><span>The private agent system</span></span>
              <span className="line-mask"><span>for investing.</span></span>
            </h1>
            <p className="v-hero-sub sub-reveal">
              Build the case before entry. Track what matters while you hold.<br/>
              Know exactly when to trim, add, or exit.
            </p>
            <div className="v-hero-cta sub-reveal delay-cta">
              <button className="v-btn-primary" onClick={openModal}>Request Access</button>
            </div>
          </div>
          {/* Animated Background Ambience */}
          <div className="v-glow-orb"></div>
        </section>

        {/* Cinematic Product Demo */}
        <section className="v-tabs-section">
          <div className="v-showcase-text" data-reveal>
            <span className="v-tag">See It In Action</span>
            <h2 className="v-h2">Your caddie, at work.</h2>
            <p className="v-p">Watch Vanna connect a new idea to what has already worked, track what would break the thesis, and warn when the same bet is getting too crowded.</p>
          </div>

          <div className="v-chatshell-mock" ref={demoRef} style={{ position: "relative", zIndex: 2 }} data-reveal>
            <div className="vc-header">
              <div className="vc-dots"><span className="vc-dot red"></span><span className="vc-dot yellow"></span><span className="vc-dot green"></span></div>
              <div className="vc-title">Vanna</div>
            </div>
            <div className={`vc-body-demo ${isResetting ? 'chat-fade-out' : ''}`} key={demoRunId} ref={demoBodyRef}>
              {DEMO_FRAMES.slice(0, demoStep + 1).map((frame, i) => {
                if (frame.type === "user") {
                  return (
                    <div key={i} className="vc-msg user">
                      <div className="vc-bubble">{renderBubbleText(frame.text)}</div>
                    </div>
                  );
                }
                if (frame.type === "vanna") {
                  return (
                    <div key={i} className="vc-msg system">
                      <div className="vc-avatar">V</div>
                      <div className="vc-bubble">{renderBubbleText(frame.text)}</div>
                    </div>
                  );
                }
                return null;
              })}
              
              {isTyping && (
                <div className="vc-msg system vc-typing">
                  <div className="vc-avatar">V</div>
                  <div className="vc-bubble">
                    <span /><span /><span />
                  </div>
                </div>
              )}
            </div>
            <div className="vc-footer">
              <div className="vc-input-ghost">What are you thinking about trading?</div>
            </div>
          </div>

          <div className="v-glow-orb" style={{ opacity: 0.15, zIndex: 0, width: "60vw", height: "60vw", top: "50%" }}></div>
        </section>

        {/* 3 Value Layers - Sticky Storytelling */}
        <section className="v-layers">
          <div className="v-layer-intro" data-reveal>
            <span className="v-tag">One System. Three Layers.</span>
            <h2 className="v-h2">The caddie for self-directed investors.</h2>
            <p className="v-p">See what you hold, build the case for every move, and learn how you invest over time.</p>
          </div>
          
          <div className="v-layer-grid">
            <div className="v-layer-card" data-reveal>
               <h3 className="v-h3">01 Portfolio Understanding</h3>
               <p className="v-p">Know how your positions relate to each other, not just what you own. Vanna shows when three tickers are really one macro bet, so you can size with eyes open.</p>
            </div>
            <div className="v-layer-card" data-reveal>
               <h3 className="v-h3">02 Thesis Creation</h3>
               <p className="v-p">Turn instinct into a challengeable thesis. Vanna pressure-tests your reasoning, sharpens the real claim, and saves the exact logic you are committing to.</p>
            </div>
            <div className="v-layer-card" data-reveal>
               <h3 className="v-h3">03 Thought &amp; Pattern Understanding</h3>
               <p className="v-p">Learn how you actually invest over time. Vanna turns reflections, repeated behaviors, and portfolio decisions into patterns you can see, question, and improve.</p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="v-footer">
          <div className="v-footer-content" data-reveal>
            <h2 className="v-footer-title">Calmer, sharper conviction.</h2>
            <p className="v-footer-sub">Join the waitlist for the most definitive operating system for self-directed investors.</p>
            <button className="v-btn-primary large" onClick={openModal}>Join the Waitlist</button>
          </div>
          <div className="v-watermark">VANNA</div>
        </footer>
      </main>

      {/* Pristine Waitlist Modal */}
      {isModalOpen && (
        <div className="v-modal-overlay" role="presentation" onClick={closeModal}>
          <div className="v-modal-card fade-in" role="dialog" aria-modal="true" aria-label="Waitlist signup" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="v-modal-close" onClick={closeModal} aria-label="Close">×</button>
            {isSuccess ? (
              <div className="v-modal-success">
                <div className="v-success-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                </div>
                <h3 className="v-modal-h3">You're on the list!</h3>
                <p className="v-modal-p">
                  {alreadyJoined ? "You're already on the waitlist. We'll keep you posted." : "We'll secure your spot in line and notify you when access is granted."}
                </p>
              </div>
            ) : (
              <>
                <h3 className="v-modal-h3">Early Access</h3>
                <p className="v-modal-p">Vanna is currently heavily restricted. Request access to join the next onboarding cohort.</p>
                <form className="v-form" onSubmit={handleSubmit}>
                  <div className="v-honeypot" aria-hidden="true">
                    <input type="text" name="website" tabIndex={-1} value={website} onChange={(e) => setWebsite(e.target.value)} />
                  </div>
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
                    onChange={(e) => handleEmailChange(e.target.value)}
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
                    {isSubmitting ? "Processing..." : "Secure My Spot"}
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
