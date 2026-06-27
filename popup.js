let currentAnalysis = null;
let currentTabUrl = null;

document.addEventListener('DOMContentLoaded', () => {
  const scanBtn = document.getElementById('scanBtn');
  const reanalyzeBtn = document.getElementById('reanalyzeBtn');
  const wonBtn = document.getElementById('wonBtn');
  const lostBtn = document.getElementById('lostBtn');
  const resultsSection = document.getElementById('resultsSection');
  const outcomeButtons = document.getElementById('outcomeButtons');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  const gateMessage = document.getElementById('gateMessage');
  const analyzeTabBtn = document.getElementById('analyzeTabBtn');
  const historyTabBtn = document.getElementById('historyTabBtn');
  const analyzePanel = document.getElementById('analyzePanel');
  const historyPanel = document.getElementById('historyPanel');

  scanBtn.addEventListener('click', () => scanJob(false));
  reanalyzeBtn.addEventListener('click', () => scanJob(true));
  wonBtn.addEventListener('click', () => saveOutcome('won'));
  lostBtn.addEventListener('click', () => saveOutcome('lost'));
  analyzeTabBtn.addEventListener('click', () => switchTab('analyze'));
  historyTabBtn.addEventListener('click', () => switchTab('history'));

  initPopup();

  // ─── Page type detection ─────────────────────────────────────────────
  function getPageType(url) {
    if (!url) return 'unknown';
    if (!url.includes('upwork.com')) return 'not-upwork';

    // Job detail pages — check first before browse patterns
    // Covers: /nx/find-work/best-matches/details/~xxx AND /jobs/~xxx
    if (/\/details\/~[a-z0-9]+/i.test(url)) return 'upwork-job';
    if (/upwork\.com\/(jobs|contracts)\/~[a-z0-9]+/i.test(url)) return 'upwork-job';

    const browsePatterns = [
      /upwork\.com\/?$/,
      /upwork\.com\/nx\/find-work\/best-matches(\?|$)/,
      /upwork\.com\/nx\/find-work\/most-recent(\?|$)/,
      /upwork\.com\/nx\/find-work\/?(\?|$)/,
      /upwork\.com\/ab\/find-work/,
      /upwork\.com\/nx\/jobs\/?(\?.*)?$/,
      /upwork\.com\/o\/profiles/,
      /upwork\.com\/nx\/search/,
      /upwork\.com\/nx\/messages/,
      /upwork\.com\/nx\/notifications/,
      /upwork\.com\/nx\/dashboard/,
    ];

    for (const pattern of browsePatterns) {
      if (pattern.test(url)) return 'upwork-browse';
    }

    return 'upwork-job';
  }

  // ─── Tab switching ───────────────────────────────────────────────────
  function switchTab(tab) {
    if (tab === 'analyze') {
      analyzeTabBtn.classList.add('active');
      historyTabBtn.classList.remove('active');
      analyzePanel.style.display = 'block';
      historyPanel.style.display = 'none';
    } else {
      historyTabBtn.classList.add('active');
      analyzeTabBtn.classList.remove('active');
      historyPanel.style.display = 'block';
      analyzePanel.style.display = 'none';
      renderHistory();
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────
  async function initPopup() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabUrl = tab.url;

      const pageType = getPageType(currentTabUrl);

      if (pageType === 'not-upwork') {
        showGate('🔒 FreelancerCopilot only works on <strong>Upwork</strong>. Open a job posting there to get started.');
        return;
      }

      if (pageType === 'upwork-browse') {
        showGate('👆 You\'re on a browse page. Open a specific <strong>job posting</strong> first, then click Analyze.');
        return;
      }

      // Valid job page — check cache
      const result = await chrome.storage.local.get(currentTabUrl);
      if (result[currentTabUrl]) {
        currentAnalysis = result[currentTabUrl];
        displayResults(currentAnalysis);
        resultsSection.classList.add('visible');
      }
    } catch (error) {
      console.error('Init error:', error);
    }
  }

  function showGate(message) {
    gateMessage.innerHTML = message;
    gateMessage.classList.add('visible');
    scanBtn.style.display = 'none';
    reanalyzeBtn.style.display = 'none';
  }

  // ─── Scan ────────────────────────────────────────────────────────────
  async function scanJob(forceReanalyze = false) {
    hideMessages();
    showLoader(true);

    try {
      if (!forceReanalyze && currentTabUrl) {
        const cached = await chrome.storage.local.get(currentTabUrl);
        if (cached[currentTabUrl]) {
          currentAnalysis = cached[currentTabUrl];
          displayResults(currentAnalysis);
          showLoader(false);
          return;
        }
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          function getJobText() {
            const selectors = [
              '[data-test="job-description"]',
              '.job-description',
              'article',
              'main'
            ];
            for (const selector of selectors) {
              const el = document.querySelector(selector);
              if (el) return el.innerText.slice(0, 3000);
            }
            return document.body.innerText.slice(0, 3000);
          }
          return getJobText();
        }
      });

      if (!injectionResults || injectionResults.length === 0) {
        throw new Error('Failed to extract page content');
      }

      const pageContent = injectionResults[0].result;

      if (!pageContent || pageContent.trim().length < 50) {
        throw new Error('Not enough content found on this page');
      }

      await analyzeJob(pageContent);
    } catch (error) {
      console.error('Scan error:', error);
      showError(`Error: ${error.message}`);
      showLoader(false);
    }
  }

  // ─── Analyze ─────────────────────────────────────────────────────────
  async function analyzeJob(jobContent) {
    try {
      // Load any custom instructions added after expert proposal meetings
      const stored = await chrome.storage.local.get('customInstructions');
      const customInstructions = stored.customInstructions || '';

      const systemPrompt = `You are an expert co-pilot for Pakistani freelancers on Upwork. Analyze job postings deeply and return honest, specific assessments.

BUDGET EXTRACTION RULES (follow exactly):
- If ANY dollar amount or range appears — "$500–$1,000", "$50/hr", "Budget: $200 to $500", "Fixed: $300" — extract it as the budget. Do NOT flag as "No clear budget".
- Only add "No clear budget specified" to red_flags if there is LITERALLY zero price or dollar information anywhere in the text.
- For hourly jobs: use the hourly rate range shown on the page.
- For fixed-price jobs: use the fixed amount shown.

CONFIDENCE SCORE — calculate precisely using this formula. Do NOT default to 80:
Start at 50, then add or subtract:
+15 if client payment is verified
+10 if client rating is 4.5 stars or above
+10 if budget is clearly stated anywhere
+10 if job description is detailed and specific (has real requirements, not vague)
+10 if required skills are clearly listed
+5 if client has hired before (hire rate shown is above 0%)
+5 if a timeline or deadline is mentioned
-10 per genuine red flag found (max -30 total)
-15 if job description is vague, very short, or copy-pasted filler
-20 if budget is unrealistically low for the scope described
-10 if client has zero reviews or no history at all
-10 if job title does not match the description body
The final score MUST reflect actual job quality. A well-described job with verified payment and clear budget should score 80-90. A vague job with no client history should score 30-50.

BID vs SKIP:
- BID if confidence >= 55 and no critical red flags
- SKIP if budget is too low for scope, client score is Bad, or 3+ red flags

RED FLAGS — only list real issues:
- Unrealistic scope for the budget amount
- Client payment method not verified
- No client history or reviews at all
- Vague or contradictory requirements
- Budget far too low for the work described
- DO NOT list a budget range as a red flag

PROPOSAL WRITING RULES:
- First line must reference a specific detail from THIS job (project type, tech stack, or goal mentioned)
- Briefly mention one relevant past experience (keep it concrete)
- Explain your approach in 2-3 sentences
- Stay under 200 words, confident but not salesy
- End with a clear call to action${customInstructions ? '\n\nADDITIONAL RULES FROM EXPERT REVIEW:\n' + customInstructions : ''}

Return ONLY raw JSON (no markdown, no backticks, no explanation) with exactly these fields:
job_title (string extracted from the page)
bid_recommendation (BID or SKIP)
confidence_score (integer 0-100, calculated strictly using the formula above)
reason (2-3 sentences with specific details from this exact job)
proposal_draft (full personalized proposal for this job)
price_low (integer USD)
price_high (integer USD)
red_flags (array of strings — empty array [] if none, never include budget ranges)
client_score (Good, Average, or Bad)
estimated_hours (integer)`;

      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: jobContent }
            ]
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();

      if (!data.choices?.[0]?.message?.content) {
        throw new Error('Unexpected API response structure');
      }

      const rawText = data.choices[0].message.content;
      const cleanedText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const analysis = JSON.parse(cleanedText);

      currentAnalysis = {
        job_title: analysis.job_title || 'Untitled Job',
        bid_recommendation: analysis.bid_recommendation,
        confidence_score: analysis.confidence_score,
        reason: analysis.reason,
        proposal_draft: analysis.proposal_draft,
        price_low: analysis.price_low,
        price_high: analysis.price_high,
        red_flags: analysis.red_flags || [],
        client_score: analysis.client_score,
        estimated_hours: analysis.estimated_hours,
        job_content: jobContent,
        timestamp: Date.now(),
        url: currentTabUrl,
      };

      await chrome.storage.local.set({ [currentTabUrl]: currentAnalysis });
      await saveToHistory(currentAnalysis);
      displayResults(currentAnalysis);
    } catch (error) {
      console.error('Analysis error:', error);
      showError(`Error: ${error.message}`);
    } finally {
      showLoader(false);
    }
  }

  // ─── History ─────────────────────────────────────────────────────────
  async function saveToHistory(analysis) {
    try {
      const stored = await chrome.storage.local.get('analysisHistory');
      const history = stored.analysisHistory || [];

      // Remove old entry for same URL (dedup), then prepend new one
      const filtered = history.filter(item => item.url !== analysis.url);
      filtered.unshift({
        url: analysis.url,
        job_title: analysis.job_title,
        timestamp: analysis.timestamp,
        bid_recommendation: analysis.bid_recommendation,
        confidence_score: analysis.confidence_score,
        price_low: analysis.price_low,
        price_high: analysis.price_high,
        reason: analysis.reason,
        proposal_draft: analysis.proposal_draft,
        red_flags: analysis.red_flags,
        client_score: analysis.client_score,
        estimated_hours: analysis.estimated_hours,
      });

      if (filtered.length > 50) filtered.splice(50);
      await chrome.storage.local.set({ analysisHistory: filtered });
    } catch (error) {
      console.error('History save error:', error);
    }
  }

  async function renderHistory() {
    const historyList = document.getElementById('historyList');
    const stored = await chrome.storage.local.get('analysisHistory');
    const history = stored.analysisHistory || [];

    historyList.innerHTML = '';

    if (history.length === 0) {
      historyList.innerHTML = '<p class="no-history">No analyses yet. Scan some jobs first!</p>';
      return;
    }

    history.forEach(item => {
      const date = new Date(item.timestamp).toLocaleString('en-PK', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const flagsHtml = item.red_flags && item.red_flags.length > 0
        ? `<div class="history-flags">🚩 ${item.red_flags.join(' · ')}</div>`
        : '';

      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="history-header">
          <span class="history-badge ${item.bid_recommendation === 'BID' ? 'bid' : 'skip'}">${item.bid_recommendation}</span>
          <span class="history-score">${item.confidence_score}%</span>
          <span class="history-date">${date}</span>
        </div>
        <div class="history-title">${item.job_title}</div>
        <div class="history-meta">💰 $${item.price_low}–$${item.price_high} &nbsp;·&nbsp; ⏱ ${item.estimated_hours}h &nbsp;·&nbsp; ${item.client_score || '—'}</div>
        <div class="history-reason">${item.reason}</div>
        ${flagsHtml}
        <a href="${item.url}" class="history-link" target="_blank">Open Job ↗</a>
      `;
      historyList.appendChild(div);
    });
  }

  // ─── Display results ─────────────────────────────────────────────────
  function displayResults(analysis) {
    const bidBadge = document.getElementById('bidBadge');
    const confidenceScore = document.getElementById('confidenceScore');
    const reasonText = document.getElementById('reasonText');
    const proposalText = document.getElementById('proposalText');
    const priceRange = document.getElementById('priceRange');
    const redFlagsList = document.getElementById('redFlagsList');
    const clientScore = document.getElementById('clientScore');
    const estimatedHours = document.getElementById('estimatedHours');

    bidBadge.textContent = analysis.bid_recommendation;
    bidBadge.className = 'bid-badge ' + (analysis.bid_recommendation === 'BID' ? 'bid' : 'skip');

    if (analysis.confidence_score !== undefined) {
      confidenceScore.textContent = `Confidence: ${analysis.confidence_score}%`;
    }

    reasonText.textContent = analysis.reason;
    proposalText.textContent = analysis.proposal_draft;
    priceRange.textContent = `$${analysis.price_low} – $${analysis.price_high}`;

    if (analysis.client_score) {
      clientScore.textContent = analysis.client_score;
      clientScore.className = 'detail-value client-' + analysis.client_score.toLowerCase();
    }

    if (analysis.estimated_hours) {
      estimatedHours.textContent = analysis.estimated_hours + ' hrs';
    }

    redFlagsList.innerHTML = '';
    if (analysis.red_flags.length === 0) {
      const li = document.createElement('li');
      li.className = 'no-flags';
      li.textContent = 'No red flags detected';
      redFlagsList.appendChild(li);
    } else {
      analysis.red_flags.forEach(flag => {
        const li = document.createElement('li');
        li.textContent = flag;
        redFlagsList.appendChild(li);
      });
    }

    resultsSection.classList.add('visible');
    outcomeButtons.classList.add('visible');
  }

  // ─── Save outcome ─────────────────────────────────────────────────────
  async function saveOutcome(outcome) {
    if (!currentAnalysis) {
      showError('No analysis data to save.');
      return;
    }

    hideMessages();

    const proposalData = {
      job_description: currentAnalysis.job_content || '',
      generated_proposal: currentAnalysis.proposal_draft,
      suggested_price_low: currentAnalysis.price_low,
      suggested_price_high: currentAnalysis.price_high,
      bid_recommendation: currentAnalysis.bid_recommendation,
      red_flags: currentAnalysis.red_flags.join(', '),
      outcome,
    };

    try {
      const response = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/proposals`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: CONFIG.SUPABASE_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(proposalData),
        }
      );

      if (!response.ok) throw new Error(`Supabase error: ${response.status}`);

      showSuccess(`Marked as ${outcome} ✓ Saved to Supabase.`);
      outcomeButtons.classList.remove('visible');
    } catch (error) {
      console.error('Save error:', error);
      showError('Failed to save. Please try again.');
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────
  function showLoader(show) {
    loader.classList.toggle('visible', show);
    if (show) resultsSection.classList.remove('visible');
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.add('visible');
  }

  function showSuccess(msg) {
    successMessage.textContent = msg;
    successMessage.classList.add('visible');
  }

  function hideMessages() {
    errorMessage.classList.remove('visible');
    successMessage.classList.remove('visible');
  }
});
