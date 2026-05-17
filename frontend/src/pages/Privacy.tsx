import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#080808] text-neutral-900 dark:text-neutral-100 transition-colors">
      <div className="max-w-3xl mx-auto px-6 py-20">
        <Link to="/" className="text-sm text-amber-500 hover:text-amber-400 mb-8 inline-block">← Back to home</Link>
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-neutral-500 mb-12">Last updated: May 17, 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-base leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. What We Collect</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-neutral-600 dark:text-neutral-400">
              <li><strong>Account data:</strong> email, name, and profile information from your authentication provider (Clerk).</li>
              <li><strong>Project data:</strong> issues, comments, TLDRs, attachments, and other content you create.</li>
              <li><strong>Usage data:</strong> API request logs, page views, and feature usage (anonymized).</li>
              <li><strong>Technical data:</strong> IP address, browser type, device info for security and performance.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. How We Use It</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-neutral-600 dark:text-neutral-400">
              <li>Provide, maintain, and improve the Baaton service.</li>
              <li>Authenticate your identity and secure your account.</li>
              <li>Send transactional emails (issue updates, notifications).</li>
              <li>Analyze usage patterns to improve the product (aggregated, never sold).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Data Storage & Security</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              Your data is stored on servers in the EU (AWS eu-west-3, Paris). We use encryption in transit (TLS 1.3) 
              and at rest. Access is restricted to essential personnel only.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Third Parties</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-neutral-600 dark:text-neutral-400">
              <li><strong>Clerk:</strong> Authentication (SSO, session management).</li>
              <li><strong>Google Gemini:</strong> AI assistant features (your data is not used for model training).</li>
              <li><strong>GitHub:</strong> Issue sync (only when you enable the integration).</li>
            </ul>
            <p className="text-neutral-600 dark:text-neutral-400 mt-2">We do not sell your data. Period.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Your Rights (GDPR)</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              You can request access, correction, deletion, or export of your data at any time. 
              Email <a href="mailto:haros@agentmail.to" className="text-amber-500 hover:underline">haros@agentmail.to</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Cookies</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              We use essential cookies only (authentication session, theme preference). No tracking cookies, no ad networks.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Contact</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              Questions? Email <a href="mailto:haros@agentmail.to" className="text-amber-500 hover:underline">haros@agentmail.to</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
