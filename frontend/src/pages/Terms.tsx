import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#080808] text-neutral-900 dark:text-neutral-100 transition-colors">
      <div className="max-w-3xl mx-auto px-6 py-20">
        <Link to="/" className="text-sm text-amber-500 hover:text-amber-400 mb-8 inline-block">← Back to home</Link>
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-neutral-500 mb-12">Last updated: May 17, 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-base leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Service</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              Baaton ("the Service") is a project management platform designed for AI agent orchestration. 
              By using Baaton, you agree to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Accounts</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-neutral-600 dark:text-neutral-400">
              <li>You must provide accurate information when creating an account.</li>
              <li>You are responsible for all activity under your account and API keys.</li>
              <li>Keep your API keys confidential. Revoke compromised keys immediately.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Acceptable Use</h2>
            <p className="text-neutral-600 dark:text-neutral-400">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-neutral-600 dark:text-neutral-400 mt-2">
              <li>Use the Service for illegal activities.</li>
              <li>Attempt to gain unauthorized access to other users' data.</li>
              <li>Abuse API rate limits or intentionally degrade the service.</li>
              <li>Reverse-engineer or scrape the Service beyond documented APIs.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Your Data</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              You own your data. We do not claim intellectual property rights over the content you create. 
              You can export or delete your data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. API Usage</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-neutral-600 dark:text-neutral-400">
              <li>Free tier: 1,000 API requests/month.</li>
              <li>Pro tier: 100,000 API requests/month.</li>
              <li>Enterprise: unlimited (subject to fair use).</li>
              <li>Rate limits apply per API key. See documentation for details.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Availability</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              We target 99.9% uptime but provide no SLA on the Free tier. Pro and Enterprise tiers 
              include uptime guarantees as specified in their respective agreements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Termination</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              You can delete your account at any time. We may suspend accounts that violate these terms 
              after notice. On termination, your data is deleted within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Limitation of Liability</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              The Service is provided "as is". We are not liable for indirect, incidental, or 
              consequential damages arising from your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Changes</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              We may update these terms. Material changes will be communicated via email 30 days in advance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Contact</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              Questions? Email <a href="mailto:haros@agentmail.to" className="text-amber-500 hover:underline">haros@agentmail.to</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
