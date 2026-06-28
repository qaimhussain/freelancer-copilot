# FreelancerCopilot

A Chrome extension that acts as an AI co-pilot for Pakistani freelancers on Upwork. Open any job post, click Analyze, and get an instant bid recommendation, full proposal draft, price range, and red flag warnings — all powered by AI.

Built in one night \& sitting

\---

## What It Does

FreelancerCopilot scans any Upwork job posting and returns:

* **Bid or Skip** recommendation with a confidence score (0–100)
* **Full proposal draft** tailored to that specific job
* **Suggested price range** based on the job scope
* **Red flag warnings** so you know what to watch out for before applying
* **Client score** (Good / Average / Bad) based on their history
* **Estimated hours** for the job

Every result is saved. You mark each proposal as Won or Lost, and the system builds a history of outcomes over time so the AI gets smarter the more you use it.

\---

## How It Works

1. You open a job post on Upwork
2. Click the FreelancerCopilot extension icon
3. Click **Analyze**
4. The extension extracts the job description from the page
5. It sends that content to the Groq AI API (running LLaMA 3.3 70B)
6. The AI returns a structured analysis — recommendation, proposal, price, red flags
7. Results display instantly inside the extension popup
8. You mark the outcome (Won / Lost) and it saves to Supabase
9. A Make.com automation watches for wins and copies winning proposals into a knowledge base for future learning

\---

## Tech Stack

|Layer|Tool|
|-|-|
|Extension UI|HTML, CSS, JavaScript (Chrome Extension)|
|AI Brain|Groq API — llama-3.3-70b-versatile|
|Database|Supabase (PostgreSQL)|
|Automation|Make.com|
|Repo|GitHub|

\---

## Database Structure

Three tables in Supabase:

**freelancers** — stores freelancer profile info (name, skill, platform, pricing range)

**proposals** — stores every analysis result (job description, generated proposal, suggested price, red flags, bid recommendation, outcome)

**knowledge\_base** — stores winning proposals automatically via Make.com automation, used to improve future recommendations over time

\---

## APIs Used

**Groq API**

* Model: `llama-3.3-70b-versatile`
* Used for: analyzing job posts, generating proposals, scoring confidence
* Free tier: 12,000 tokens per minute
* Docs: console.groq.com

**Supabase**

* Used for: storing proposals, tracking win/loss outcomes, knowledge base
* Tables: freelancers, proposals, knowledge\_base
* Docs: supabase.com/docs

**Make.com**

* Used for: automation trigger when a proposal is marked as Won
* Workflow: Supabase webhook → filter for outcome = won → insert into knowledge\_base
* Docs: make.com

\---

## Setup

1. Clone this repo
2. Create a `config.js` file in the root folder with your own API keys:

```js
const CONFIG = {
  GROQ\\\_API\\\_KEY: 'your-groq-api-key',
  SUPABASE\\\_URL: 'your-supabase-project-url',
  SUPABASE\\\_KEY: 'your-supabase-anon-key',
}
```

3. Go to `chrome://extensions` in Chrome
4. Enable **Developer Mode** (toggle, top right)
5. Click **Load unpacked**
6. Select this project folder
7. Open any Upwork job post and click the extension icon

\---

## Current Limitations

* Works on Upwork job pages only (shows a message on browse/homepage)
* Groq free tier has token limits (content is capped at 3000 characters per scan)
* No user authentication yet (single user, local storage)
* Knowledge base learning is basic — full outcome intelligence is on the roadmap

\---

## Project Status

This is a working prototype built to validate the concept. 

\---

*Built by Qaim Hussain*

