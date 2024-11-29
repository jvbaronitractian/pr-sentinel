import * as dotenv from "dotenv";
import { Octokit } from "octokit";

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const USER_AGENT = "pr-sentinel/1.0.0";
const DAYS_THRESHOLD = 2;

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
  console.error(
    "Error: Make sure GITHUB_TOKEN, REPO_OWNER, and REPO_NAME are defined in the .env file."
  );
  process.exit(1);
}

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  userAgent: USER_AGENT,
});

const pullRequests = await octokit.rest.search.issuesAndPullRequests({
  q: `repo:${REPO_OWNER}/${REPO_NAME} state:open is:pr is:open`,
  per_page: 10,
});

const thresholdDate = new Date();

thresholdDate.setDate(thresholdDate.getDate() - DAYS_THRESHOLD);

for (const pr of pullRequests.data.items) {
  const requestedReviewersResponse =
    await octokit.rest.pulls.listRequestedReviewers({
      owner: REPO_OWNER,
      pull_number: pr.number,
      repo: REPO_NAME,
    });

  const requestedReviewers = requestedReviewersResponse.data.users.map(
    (user) => user.login
  );

  const reviewsResponse = await octokit.rest.pulls.listReviews({
    owner: REPO_OWNER,
    pull_number: pr.number,
    repo: REPO_NAME,
  });

  const reviews = reviewsResponse.data;

  const reviewersWithReviews = new Set(
    reviews.map((review) => review.user.login)
  );

  const prCreatedAt = new Date(pr.created_at);

  const delayedReviewers: string[] = [];

  for (const reviewer of requestedReviewers) {
    const hasNotReviewed = !reviewersWithReviews.has(reviewer);
    const isOutOfThreshold = prCreatedAt < thresholdDate;

    if (hasNotReviewed && isOutOfThreshold) {
      delayedReviewers.push(reviewer);
    }
  }

  for (const review of reviews) {
    if (review.state === "PENDING") {
      const reviewDate = review.submitted_at
        ? new Date(review.submitted_at)
        : prCreatedAt;
      const isOutOfThreshold = reviewDate < thresholdDate;

      if (isOutOfThreshold) {
        delayedReviewers.push(review.user.login);
      }
    }
  }

  const uniqueDelayedReviewers = Array.from(new Set(delayedReviewers));

  if (uniqueDelayedReviewers.length > 0) {
    console.log(
      `PR #${pr.number} - Reviewers delayed (no review or pending review for more than ${DAYS_THRESHOLD} days):`
    );
    for (const reviewer of uniqueDelayedReviewers) {
      console.log(`- ${reviewer}`);
    }
  }
}
