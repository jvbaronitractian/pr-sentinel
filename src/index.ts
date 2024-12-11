import { createObjectCsvWriter } from "csv-writer";
import * as dotenv from "dotenv";
import moment from "moment-timezone";
import { Octokit } from "octokit";

dotenv.config();

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

const USER_AGENT = "pr-sentinel/1.0.0";
const OUTPUT_CSV = "pr_reviewers.csv";
const DAYS_THRESHOLD = 2;

if (!AUTH_TOKEN || !REPO_OWNER || !REPO_NAME) {
  console.error(
    "Error: Make sure AUTH_TOKEN, REPO_OWNER, and REPO_NAME are defined in the .env file."
  );
  process.exit(1);
}

enum ReviewStatus {
  PENDING = "PENDING",
  REVIEW_REQUESTED = "REVIEW_REQUESTED",
}

type DelayedReviewers = {
  author: string;
  pullNumber: number;
  lastReviewDate: string;
};

const csvWriter = createObjectCsvWriter({
  path: OUTPUT_CSV,
  header: [
    { id: "pullNumber", title: "PR Number" },
    { id: "author", title: "Reviewer" },
    { id: "lastReviewDate", title: "Last Review Date" },
  ],
});

const octokit = new Octokit({
  auth: AUTH_TOKEN,
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

  const delayedReviewers: DelayedReviewers[] = [];

  for (const reviewer of requestedReviewers) {
    const hasNotReviewed = !reviewersWithReviews.has(reviewer);
    const isOutOfThreshold = prCreatedAt < thresholdDate;

    if (hasNotReviewed && isOutOfThreshold) {
      delayedReviewers.push({
        author: reviewer,
        pullNumber: pr.number,
        lastReviewDate: "N/A",
      });
    }
  }

  for (const review of reviews) {
    if (review.state === "PENDING") {
      const reviewDate = review.submitted_at
        ? new Date(review.submitted_at)
        : prCreatedAt;
      const isOutOfThreshold = reviewDate < thresholdDate;

      if (isOutOfThreshold) {
        const formattedDate = moment(reviewDate)
          .tz("America/Sao_Paulo")
          .format("YYYY-MM-DD HH:mm:ss");

        delayedReviewers.push({
          author: review.user.login,
          pullNumber: pr.number,
          lastReviewDate: formattedDate,
        });
      }
    }
  }

  if (delayedReviewers.length > 0) {
    await csvWriter.writeRecords(delayedReviewers);

    console.log(
      `PR #${pr.number} - Reviewers delayed (no review or pending review for more than ${DAYS_THRESHOLD} days):`,
      delayedReviewers
    );
  }
}
