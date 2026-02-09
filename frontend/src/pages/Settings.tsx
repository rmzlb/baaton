import { OrganizationProfile } from '@clerk/clerk-react';

export function Settings() {
  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#fafafa]">Settings</h1>
        <p className="mt-1 text-sm text-[#a1a1aa]">
          Organization settings and API keys
        </p>
      </div>

      <div className="rounded-xl border border-[#262626] bg-[#141414] p-6">
        <OrganizationProfile
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'bg-transparent shadow-none',
            },
          }}
        />
      </div>
    </div>
  );
}
