import os

with open("src/components/DashboardToday.tsx", "r") as f:
    content = f.read()

target = """      {showUsageGuide && (
        <UsageGuide onSkip={() => {
          localStorage.setItem('staff_usage_guide_dismissed', 'true');
          setShowUsageGuide(false);
        }} />
      )}
      <ExpansionPrompt tenantId={tenantId} />
      {/* header — يلتف على الجوال */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">"""

replacement = """      {showUsageGuide ? (
        <UsageGuide onSkip={() => {
          localStorage.setItem('staff_usage_guide_dismissed', 'true');
          setShowUsageGuide(false);
        }} />
      ) : (
        <>
          <ExpansionPrompt tenantId={tenantId} />
          {/* header — يلتف على الجوال */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">"""

if target in content:
    content = content.replace(target, replacement)

target_end = """      </div>
    </div>
  );
}"""

replacement_end = """      </div>
        </>
      )}
    </div>
  );
}"""

if target_end in content:
    content = content.replace(target_end, replacement_end)

with open("src/components/DashboardToday.tsx", "w") as f:
    f.write(content)

