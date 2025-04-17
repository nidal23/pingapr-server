/**
 * Slack messaging service
 * Handles formatting and sending messages to Slack
 */
const { WebClient } = require('@slack/web-api');
const { truncateText, formatCodeBlock } = require('../../utils/formatting');

/**
 * Send a PR opened message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} pr - Pull request data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrOpenedMessage = async (token, channelId, pr) => {
  const client = new WebClient(token);
  
  // Format labels if present
  const labelsText = pr.labels && pr.labels.length > 0
    ? `\n*Labels:* ${pr.labels.join(', ')}`
    : '';
  
  // Truncate description if too long
  const description = pr.description ? truncateText(pr.description, 300) : '_No description provided_';
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `New PR: ${pr.title}`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Repository:* ${pr.repoName}\n*Author:* ${pr.author}\n*Changes:* +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)${labelsText}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: description
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View on GitHub",
                emoji: true
              },
              url: pr.url,
              action_id: "view_pr"
            }
          ]
        }
      ],
      text: `New PR: ${pr.title} by ${pr.author}`
    });
  } catch (error) {
    console.error('Error sending PR opened message to Slack:', error);
    throw error;
  }
};

/**
 * Send a PR closed message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} pr - Pull request data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrClosedMessage = async (token, channelId, pr) => {
  const client = new WebClient(token);
  
  const status = pr.merged ? 'merged' : 'closed';
  const emoji = pr.merged ? ':merged:' : ':x:';
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${emoji} Pull request *${pr.title}* has been ${status} by *${pr.closedBy}*`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `This channel will be archived in a few days per organization settings.`
            }
          ]
        }
      ],
      text: `PR ${status}: ${pr.title} by ${pr.closedBy}`
    });
  } catch (error) {
    console.error(`Error sending PR ${status} message to Slack:`, error);
    throw error;
  }
};

/**
 * Send a PR reopened message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} pr - Pull request data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrReopenedMessage = async (token, channelId, pr) => {
  const client = new WebClient(token);
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:recycle: Pull request *${pr.title}* has been reopened by *${pr.reopenedBy}*`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View on GitHub",
                emoji: true
              },
              url: pr.url,
              action_id: "view_pr"
            }
          ]
        }
      ],
      text: `PR reopened: ${pr.title} by ${pr.reopenedBy}`
    });
  } catch (error) {
    console.error('Error sending PR reopened message to Slack:', error);
    throw error;
  }
};

/**
 * Send a PR updated message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} pr - Pull request data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrUpdatedMessage = async (token, channelId, pr) => {
  const client = new WebClient(token);
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:pencil2: *${pr.updatedBy}* updated pull request *${pr.title}* with new commits\n*Changes:* +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)`
          }
        }
      ],
      text: `PR updated: ${pr.title} by ${pr.updatedBy}`
    });
  } catch (error) {
    console.error('Error sending PR updated message to Slack:', error);
    throw error;
  }
};

/**
 * Send a PR edited message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} pr - Pull request data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrEditedMessage = async (token, channelId, pr) => {
  const client = new WebClient(token);
  
  const changes = [];
  if (pr.titleChanged) changes.push('title');
  if (pr.bodyChanged) changes.push('description');
  
  const changesText = changes.join(' and ');
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:pencil: *${pr.editedBy}* edited pull request ${changesText}\n*Title:* ${pr.title}`
          }
        }
      ],
      text: `PR edited: ${pr.title} by ${pr.editedBy}`
    });
  } catch (error) {
    console.error('Error sending PR edited message to Slack:', error);
    throw error;
  }
};

/**
 * Send a review requested message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Review request data
 * @returns {Promise<Object>} Slack message response
 */
const sendReviewRequestedMessage = async (token, channelId, data) => {
  const client = new WebClient(token);
  
  // Mention the reviewer if we have their Slack ID
  const reviewerMention = data.slackUserId 
    ? `<@${data.slackUserId}>` 
    : data.reviewer;
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:eyes: Review requested from ${reviewerMention}`
          }
        }
      ],
      text: `Review requested from ${data.reviewer}`
    });
  } catch (error) {
    console.error('Error sending review requested message to Slack:', error);
    throw error;
  }
};

/**
 * Send a review request removed message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Review request data
 * @returns {Promise<Object>} Slack message response
 */
const sendReviewRequestRemovedMessage = async (token, channelId, data) => {
  const client = new WebClient(token);
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:no_entry_sign: *${data.removedBy}* removed review request for *${data.reviewer}*`
          }
        }
      ],
      text: `Review request removed for ${data.reviewer}`
    });
  } catch (error) {
    console.error('Error sending review request removed message to Slack:', error);
    throw error;
  }
};

/**
 * Send a PR review message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Review data
 * @returns {Promise<Object>} Slack message response
 */
const sendReviewMessage = async (token, channelId, data) => {
  const client = new WebClient(token);
  
  let emoji, actionText;
  switch (data.state) {
    case 'approved':
      emoji = ':white_check_mark:';
      actionText = 'approved';
      break;
    case 'changes_requested':
      emoji = ':x:';
      actionText = 'requested changes on';
      break;
    default:
      emoji = ':speech_balloon:';
      actionText = 'commented on';
  }
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${emoji} *${data.reviewer}* ${actionText} pull request`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: data.body
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View on GitHub",
                emoji: true
              },
              url: data.url,
              action_id: "view_review"
            }
          ]
        }
      ],
      text: `${data.reviewer} ${actionText} pull request: ${data.title}`
    });
  } catch (error) {
    console.error('Error sending review message to Slack:', error);
    throw error;
  }
};

/**
 * Send a PR review state message to Slack (without comment)
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Review data
 * @returns {Promise<Object>} Slack message response
 */
const sendReviewStateMessage = async (token, channelId, data) => {
  const client = new WebClient(token);
  
  let emoji, actionText;
  switch (data.state) {
    case 'approved':
      emoji = ':white_check_mark:';
      actionText = 'approved';
      break;
    case 'changes_requested':
      emoji = ':x:';
      actionText = 'requested changes on';
      break;
    default:
      // Don't send message for just state change with no comment
      return null;
  }
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${emoji} *${data.reviewer}* ${actionText} pull request`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View on GitHub",
                emoji: true
              },
              url: data.url,
              action_id: "view_review"
            }
          ]
        }
      ],
      text: `${data.reviewer} ${actionText} pull request: ${data.title}`
    });
  } catch (error) {
    console.error('Error sending review state message to Slack:', error);
    throw error;
  }
};

/**
 * Send a PR review comment message to Slack (comment on code)
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Comment data
 * @returns {Promise<Object>} Slack message response
 */
const sendReviewCommentMessage = async (token, channelId, data) => {
    const client = new WebClient(token);
    
    // Format code snippet if present
    const codeBlock = data.diffHunk ? formatCodeBlock(data.diffHunk) : '';
    const filePath = data.path ? `*File:* \`${data.path}\`\n` : '';
    
    try {
      return await client.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:mag: *${data.author}* commented on the code:`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: filePath + codeBlock
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: data.body
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View on GitHub",
                  emoji: true
                },
                url: data.url,
                action_id: "view_code_comment"
              }
            ]
          }
        ],
        text: `${data.author} commented on code: ${truncateText(data.body, 50)}`
      });
    } catch (error) {
      console.error('Error sending review comment message to Slack:', error);
      throw error;
    }
  };

/**
 * Send a PR comment message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Comment data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrCommentMessage = async (token, channelId, data) => {
    const client = new WebClient(token);
    
    try {
      return await client.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:speech_balloon: *${data.author}* commented on the pull request:`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: data.body
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View on GitHub",
                  emoji: true
                },
                url: data.url,
                action_id: "view_comment"
              }
            ]
          }
        ],
        text: `${data.author} commented: ${truncateText(data.body, 50)}`
      });
    } catch (error) {
      console.error('Error sending PR comment message to Slack:', error);
      throw error;
    }
  };

  /**
 * Send a PR comment reply message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp to reply to
 * @param {Object} data - Comment data
 * @returns {Promise<Object>} Slack message response
 */
const sendCommentReplyMessage = async (token, channelId, threadTs, data) => {
    const client = new WebClient(token);
    
    try {
      return await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${data.author}*: ${data.body}`
            }
          }
        ],
        text: `${data.author} replied: ${truncateText(data.body, 50)}`
      });
    } catch (error) {
      console.error('Error sending comment reply message to Slack:', error);
      throw error;
    }
  };


  /**
 * Send a PR comment edited message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp to reply to
 * @param {Object} data - Comment data
 * @returns {Promise<Object>} Slack message response
 */
const sendCommentEditedMessage = async (token, channelId, threadTs, data) => {
    const client = new WebClient(token);
    
    try {
      return await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:pencil: *${data.author}* edited their comment:\n${data.body}`
            }
          }
        ],
        text: `${data.author} edited comment: ${truncateText(data.body, 50)}`
      });
    } catch (error) {
      console.error('Error sending comment edited message to Slack:', error);
      throw error;
    }
  };

  /**
 * Send a PR reminder message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Reminder data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrReminderMessage = async (token, channelId, data) => {
    const client = new WebClient(token);
    
    // Format reviewers mentions
    const reviewerMentions = data.reviewers
      .map(reviewer => reviewer.slackUserId ? `<@${reviewer.slackUserId}>` : reviewer.githubUsername)
      .join(', ');
    
    try {
      return await client.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:alarm_clock: *Reminder:* This PR has been open for ${data.hoursOpen} hours and is awaiting review from ${reviewerMentions}`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View PR",
                  emoji: true
                },
                url: data.url,
                action_id: "view_pr"
              }
            ]
          }
        ],
        text: `Reminder: PR awaiting review from ${data.reviewers.map(r => r.githubUsername).join(', ')}`
      });
    } catch (error) {
      console.error('Error sending PR reminder message to Slack:', error);
      throw error;
    }
  };

  /**
 * Send a PR merged to main message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Main team channel ID 
 * @param {Object} data - PR data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrMergedToMainChannelMessage = async (token, channelId, data) => {
    const client = new WebClient(token);
    
    try {
      return await client.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:tada: *${data.author}* merged PR: *${data.title}*\n*Repository:* ${data.repoName}`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View PR",
                  emoji: true
                },
                url: data.url,
                action_id: "view_pr"
              }
            ]
          }
        ],
        text: `${data.author} merged PR: ${data.title}`
      });
    } catch (error) {
      console.error('Error sending PR merged to main channel message to Slack:', error);
      throw error;
    }
  };
  
  module.exports = {
    sendPrOpenedMessage,
    sendPrClosedMessage,
    sendPrReopenedMessage,
    sendPrUpdatedMessage,
    sendPrEditedMessage,
    sendReviewRequestedMessage,
    sendReviewRequestRemovedMessage,
    sendReviewMessage,
    sendReviewStateMessage,
    sendPrCommentMessage,
    sendReviewCommentMessage,
    sendCommentReplyMessage,
    sendCommentEditedMessage,
    sendPrReminderMessage,
    sendPrMergedToMainChannelMessage
  };
