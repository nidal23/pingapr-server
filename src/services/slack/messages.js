//src/services/slack/messages
/**
 * Slack messaging service
 * Handles formatting and sending messages to Slack
 */
const { WebClient } = require('@slack/web-api');
const { truncateText, formatCodeBlock } = require('../../utils/formatting');
const db = require('../../services/supabase/functions');
/**
 * Format code snippets for better display in Slack using rich text blocks
 * @param {string} body - Comment body that may contain code
 * @returns {Array} Array of blocks with code properly formatted
 */
const formatCodeSnippets = (body) => {
  if (!body) return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No content_"
      }
    }
  ];
  
  // If there are no code blocks or inline code, return simple text
  if (!body.includes('`')) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: body
        }
      }
    ];
  }
  
  // Check if the body contains code blocks (```)
  if (body.includes('```')) {
    // Extract code blocks and regular text
    const parts = [];
    let currentIndex = 0;
    const codeBlockRegex = /```(?:\w*\n|\n)?([^```]+)```/g;
    
    let match;
    while ((match = codeBlockRegex.exec(body)) !== null) {
      // Add text before code block if any
      const precedingText = body.substring(currentIndex, match.index).trim();
      if (precedingText) {
        parts.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: precedingText
          }
        });
      }
      
      // Add code block
      parts.push({
        type: "rich_text",
        elements: [
          {
            type: "rich_text_preformatted",
            elements: [
              {
                type: "text",
                text: match[1].trim()
              }
            ]
          }
        ]
      });
      
      currentIndex = match.index + match[0].length;
    }
    
    // Add any remaining text
    const remainingText = body.substring(currentIndex).trim();
    if (remainingText) {
      parts.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: remainingText
        }
      });
    }
    
    return parts;
  }
  
  // Handle inline code
  if (body.includes('`') && !body.includes('```')) {
    const parts = [];
    let currentIndex = 0;
    const inlineCodeRegex = /`([^`]+)`/g;
    
    let match;
    while ((match = inlineCodeRegex.exec(body)) !== null) {
      // Add text before code if any
      const precedingText = body.substring(currentIndex, match.index).trim();
      if (precedingText) {
        parts.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: precedingText
          }
        });
      }
      
      // For short inline code (less than 40 chars), keep it inline
      if (match[1].length < 40) {
        parts.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: '`' + match[1] + '`'
          }
        });
      } else {
        // For longer code snippets, use preformatted block
        parts.push({
          type: "rich_text",
          elements: [
            {
              type: "rich_text_preformatted",
              elements: [
                {
                  type: "text",
                  text: match[1].trim()
                }
              ]
            }
          ]
        });
      }
      
      currentIndex = match.index + match[0].length;
    }
    
    // Add any remaining text
    const remainingText = body.substring(currentIndex).trim();
    if (remainingText) {
      parts.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: remainingText
        }
      });
    }
    
    return parts;
  }
  
  // Default case - no code formatting needed
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: body
      }
    }
  ];
};


/**
 * Format PR description for display in Slack
 * @param {string} description - The PR description
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} Formatted description
 */
const formatPrDescription = (description, maxLength = 1000) => {
  if (!description || description.trim() === '') {
    return '_No description provided_';
  }
  
  // Format the description
  let formattedDescription = description;
  
  // Handle any type of ticket/issue references with links
  // Pattern: KEYWORD-123 (http://example.com/KEYWORD-123) or similar
  const ticketRegex = /([A-Z0-9]+-[0-9]+)\s*\((https?:\/\/[^)]+)\)/g;
  formattedDescription = formattedDescription.replace(ticketRegex, (match, ticketId, url) => {
    return `<${url}|${ticketId}>`;
  });
  
  // Handle generic URLs that aren't part of a more complex pattern
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  formattedDescription = formattedDescription.replace(urlRegex, (match) => {
    // Skip URLs that are already part of Slack's link syntax (<url|text>)
    if (match.startsWith('<http') && match.includes('|')) {
      return match;
    }
    return `<${match}>`;
  });
  
  // Replace GitHub mentions with better formatting
  formattedDescription = formattedDescription.replace(/@([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)/g, '*@$1/$2*');
  
  // Replace line breaks properly for Slack
  formattedDescription = formattedDescription.replace(/\r\n/g, '\n');
  
  // Truncate if too long
  if (formattedDescription.length > maxLength) {
    return formattedDescription.substring(0, maxLength) + '... _[See full description on GitHub]_';
  }
  
  return formattedDescription;
};

/**
 * Send a PR opened message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} pr - Pull request data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrOpenedMessage = async (token, channelId, pr) => {
  const client = new WebClient(token);

  try {
    // Extract PR number for display
    const prNumber = pr.url.split('/').pop();
    
    // Format the PR description with better handling of links and mentions
    const formattedDescription = formatPrDescription(pr.description, 1000);
    
    // Format the author with Slack mention if available
    const authorText = pr.author && pr.author.slack_user_id  
      ? `<@${pr.author.slack_user_id}>` 
      : pr.author.github_username;
    
    // Format the labels if present with visual styling
    let labelsBlock = null;
    if (pr.labels && pr.labels.length > 0) {
      const formattedLabels = pr.labels.map(label => `\`${label}\``).join(' ');
      labelsBlock = {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:bookmark: *Labels:* ${formattedLabels}`
          }
        ]
      };
    }
    
    // Create the blocks array with improved structure and valid emojis
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `:arrow_heading_up: Pull Request #${prNumber}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${pr.url}|${pr.title}>*`
        }
      },
      {
        type: "divider"
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:file_folder: *Repository:* ${pr.repoName}`
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:bust_in_silhouette: *Author:* ${authorText}`
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:clipboard: *Changes:* \`+${pr.additions} -${pr.deletions}\` in ${pr.changedFiles} files`
          }
        ]
      }
    ];
    
    // Add labels block if present
    if (labelsBlock) {
      blocks.push(labelsBlock);
    }
    
    // Add reviewers section if there are reviewers
    if (pr.reviewers && pr.reviewers.length > 0) {
      const reviewerMentions = pr.reviewers.map(reviewer => {
        if (reviewer.slackUserId) {
          return `<@${reviewer.slackUserId}>`;
        }
        return reviewer.githubUsername;
      });
      
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:eyes: *Reviewers:* ${reviewerMentions.join(', ')}`
          }
        ]
      });    
    }
    
    // Add description with heading
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Description:*\n${formattedDescription}`
        }
      }
    );
    
    // Add divider before actions
    blocks.push({
      type: "divider"
    });
    
    // Add action buttons with multiple options and valid emojis
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":link: View PR",
            emoji: true
          },
          url: pr.url,
          style: "primary"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":mag: View Files",
            emoji: true
          },
          url: `${pr.url}/files`
        }
      ]
    });
    
    return await client.chat.postMessage({
      channel: channelId,
      blocks: blocks,
      text: `PR #${prNumber}: ${pr.title} opened by ${pr.author.github_username}` // Fallback text for notifications
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
  const emoji = pr.merged ? ':tada:' : ':x:';
  const color = pr.merged ? '#6f42c1' : '#cb2431';
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${emoji} Pull Request ${status.toUpperCase()}`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${pr.url}|${pr.title}>* has been ${status} ${!pr.merged ? 'without merging' : ''} by <@${pr.closedBy}>`
          }
        },
        {
          type: "divider"
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:information_source: This channel will be archived in a few days per organization settings.`
            }
          ]
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":link: View PR",
                emoji: true
              },
              url: pr.url
            }
          ]
        }
      ],
      text: `PR ${status}${!pr.merged ? ' without merging' : ''}: ${pr.title} by <@${pr.closedBy}>`
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
          type: "header",
          text: {
            type: "plain_text",
            text: `:recycle: Pull Request REOPENED`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${pr.url}|${pr.title}>* has been reopened by ${pr.reopenedBy}`
          }
        },
        {
          type: "divider"
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":link: View PR",
                emoji: true
              },
              url: pr.url,
              style: "primary"
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":mag: View Files",
                emoji: true
              },
              url: `${pr.url}/files`
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
          type: "header",
          text: {
            type: "plain_text",
            text: `:arrows_counterclockwise: PR Updated with New Commits`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${pr.url}|${pr.title}>*`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:bust_in_silhouette: *Updated by:* ${pr.updatedBy}`
            }
          ]
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:clipboard: *Changes:* \`+${pr.additions} -${pr.deletions}\` in ${pr.changedFiles} files`
            }
          ]
        },
        {
          type: "divider"
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":link: View PR",
                emoji: true
              },
              url: pr.url,
              style: "primary"
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":mag: View Files",
                emoji: true
              },
              url: `${pr.url}/files`
            }
          ]
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
          type: "header",
          text: {
            type: "plain_text",
            text: `:pencil2: PR Details Edited`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${pr.url}|${pr.title}>*`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:bust_in_silhouette: *Edited by:* ${pr.editedBy}`
            }
          ]
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:page_with_curl: *Changed parts:* ${changesText}`
            }
          ]
        },
        {
          type: "divider"
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":link: View PR",
                emoji: true
              },
              url: pr.url
            }
          ]
        }
      ],
      text: `PR edited: ${pr.title} by ${pr.editedBy} (${changesText} changed)`
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
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${reviewerMention} was added as a reviewer`
            }
          ]
        }
      ]
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
  
  // Mention the reviewer if we have their Slack ID
  const reviewerMention = data.reviewerSlackId 
    ? `<@${data.reviewerSlackId}>` 
    : data.reviewer;
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `removed the review request for ${reviewerMention}`
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Error sending review request removed message to Slack:', error);
    throw error;
  }
};

/**
 * Send a review message to Slack with rich text code formatting
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {object} review - Review data
 * @returns {Promise<object>} Slack message response
 */
const sendReviewMessage = async (token, channelId, review) => {
  try {
    const client = new WebClient(token);
    const { 
      title, 
      url, 
      reviewer, 
      reviewerSlackId, 
      state, 
      body, 
      commentCount = 0, 
      prNumber 
    } = review;
    
    // Format reviewer with Slack mention if available
    const reviewerDisplay = reviewerSlackId ? `<@${reviewerSlackId}>` : reviewer;
    
    // Format the body into blocks with proper code formatting
    const contentBlocks = body ? formatCodeSnippets(body) : [];
    
    // Common blocks shared across all review types
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${getStateIcon(state)} PR Review: ${getStateLabel(state)}`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${url}|${title}>*`
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:bust_in_silhouette: *Reviewer:* ${reviewerDisplay}`
          }
        ]
      }
    ];
    
    // Add comment count if comments were made
    if (commentCount > 0) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:speech_balloon: *Comments:* ${commentCount}`
          }
        ]
      });
    }
    
    // Add divider
    blocks.push({
      type: "divider"
    });
    
    // Add formatted content blocks if body exists
    if (contentBlocks.length > 0) {
      blocks.push(...contentBlocks);
    }
    
    // Add action buttons
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":link: View Review",
            emoji: true
          },
          url: url,
          style: state === 'approved' ? "primary" : undefined
        }
      ]
    });
    
    // Generate appropriate fallback text
    const text = getReviewText(state, reviewer, prNumber, title, commentCount);
    
    const result = await client.chat.postMessage({
      channel: channelId,
      text: text,
      blocks: blocks,
      unfurl_links: false,
      unfurl_media: false
    });
    
    return result;
  } catch (error) {
    console.error('Error sending review message to Slack:', error);
    throw error;
  }
};

/**
 * Get the icon for a review state
 * @param {string} state - Review state
 * @returns {string} Emoji icon
 */
const getStateIcon = (state) => {
  switch (state) {
    case 'approved':
      return ':white_check_mark:';
    case 'changes_requested':
      return ':x:';
    case 'commented':
      return ':speech_balloon:';
    default:
      return ':information_source:';
  }
};

/**
 * Get a user-friendly label for review state
 * @param {string} state - Review state
 * @returns {string} User-friendly state label
 */
const getStateLabel = (state) => {
  switch (state) {
    case 'approved':
      return 'APPROVED';
    case 'changes_requested':
      return 'CHANGES REQUESTED';
    case 'commented':
      return 'COMMENTED';
    default:
      return state.toUpperCase().replace('_', ' ');
  }
};

/**
 * Get appropriate review text based on state
 * @param {string} state - Review state
 * @param {string} reviewer - Reviewer name
 * @param {string} prNumber - PR number
 * @param {string} title - PR title
 * @param {number} commentCount - Number of comments
 * @returns {string} Appropriate review text
 */
const getReviewText = (state, reviewer, prNumber, title, commentCount) => {
  const commentText = commentCount > 0 ? ` with ${commentCount} comment${commentCount > 1 ? 's' : ''}` : '';
  
  switch (state) {
    case 'approved':
      return `${reviewer} approved PR #${prNumber}: ${title}${commentText}`;
    case 'changes_requested':
      return `${reviewer} requested changes on PR #${prNumber}: ${title}${commentText}`;
    case 'commented':
      return `${reviewer} commented on PR #${prNumber}: ${title}${commentText}`;
    default:
      return `${reviewer} reviewed PR #${prNumber}: ${title}${commentText}`;
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
  
  // Only send messages for approved or changes_requested states
  if (data.state !== 'approved' && data.state !== 'changes_requested') {
    return null;
  }
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${getStateIcon(data.state)} PR Review: ${getStateLabel(data.state)}`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${data.url}|${data.title}>*`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:bust_in_silhouette: *Reviewer:* ${data.reviewer}`
            }
          ]
        },
        {
          type: "divider"
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":link: View Review",
                emoji: true
              },
              url: data.url,
              style: data.state === 'approved' ? "primary" : undefined
            }
          ]
        }
      ],
      text: `${data.reviewer} ${data.state === 'approved' ? 'approved' : 'requested changes on'} pull request: ${data.title}`
    });
  } catch (error) {
    console.error('Error sending review state message to Slack:', error);
    throw error;
  }
};

/**
 * Send a review comment message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp (null for top-level)
 * @param {object} comment - Comment data
 * @returns {Promise<object>} Slack message response
 */
const sendReviewCommentMessage = async (token, channelId, threadTs, comment) => {
  try {
    const client = new WebClient(token);
    const { author, authorSlackId, body, url, path, line } = comment;

    console.log('author slack id: ', authorSlackId)
    
    // Format author with Slack mention if available
    const authorDisplay = authorSlackId ? `<@${authorSlackId}>` : author;
    
    // Format the body to properly handle code snippets
    const contentBlocks = formatCodeSnippets(body);
    
    // Create blocks array for the message
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `:speech_balloon: Code Comment`,
          emoji: true
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:bust_in_silhouette: *Author:* ${authorDisplay}`
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:page_facing_up: *Location:* \`${path}:${line}\``
          }
        ]
      },
      {
        type: "divider"
      }
    ];


    blocks.push(...contentBlocks);

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":link: View Comment",
            emoji: true
          },
          url: url
        }
      ]
    });
    
    const result = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs, // If null, creates a new thread
      text: `Comment from ${author} on ${path}:${line}`,
      blocks: blocks,
      unfurl_links: false,
      unfurl_media: false
    });
    
    return result;
  } catch (error) {
    console.error('Error sending review comment message to Slack:', error);
    throw error;
  }
};

/**
 * Send a PR comment message to Slack with rich text code formatting
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {Object} data - Comment data
 * @returns {Promise<Object>} Slack message response
 */
const sendPrCommentMessage = async (token, channelId, data) => {
  const client = new WebClient(token);
  
  // Format the body into blocks with proper code formatting
  const contentBlocks = formatCodeSnippets(data.body);
  
  try {
    // Create base blocks array for the message
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `:speech_balloon: PR Comment`,
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${data.url}|${data.title || 'View PR'}>*`
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:bust_in_silhouette: *Author:* ${data.author}`
          }
        ]
      },
      {
        type: "divider"
      }
    ];
    
    // Add the formatted content blocks
    blocks.push(...contentBlocks);
    
    // Add action button
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":link: View Comment",
            emoji: true
          },
          url: data.url
        }
      ]
    });
    
    return await client.chat.postMessage({
      channel: channelId,
      blocks: blocks,
      text: `${data.author} commented: ${truncateText(data.body, 50)}`
    });
  } catch (error) {
    console.error('Error sending PR comment message to Slack:', error);
    throw error;
  }
};

/**
 * Send a comment reply message to Slack with rich text code formatting
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {object} comment - Comment data
 * @returns {Promise<object>} Slack message response
 */
/**
 * Send comment reply message to Slack
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {Object} comment - Comment data
 * @returns {Promise<Object>} Result of message post
 */
const sendCommentReplyMessage = async (token, channelId, threadTs, comment) => {
  try {
    const { author, body, url, authorSlackId } = comment;
    console.log("Called send comment reply message method");
    
    // Try to send as user if they've authorized
    if (authorSlackId) {
      try {
        // Get user from database with their Slack token
        const userData = await db.users.findWithSlackToken(authorSlackId);
        
        console.log('user data: ', userData)
        // If user has authorized Slack, send as them
        if (userData?.slack_user_token) {
          return await sendMessageAsUser(
            userData.slack_user_token, 
            channelId, 
            threadTs, 
            body, 
            url,
            authorSlackId
          );
        }
      } catch (userError) {
        console.error('Error fetching user data:', userError);
        // Continue to bot fallback if user fetch fails
      }
    }
    
    // Fall back to sending as bot with attribution
    return await sendMessageAsBot(token, channelId, threadTs, comment);
  } catch (error) {
    console.error('Error sending comment reply message to Slack:', error);
    throw error;
  }
};

/**
 * Send message as the user themselves
 * @param {string} userToken - Slack user token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} body - Message body
 * @param {string} url - GitHub URL
 * @param {string} userId - User ID for error handling
 * @returns {Promise<Object>} Result of message post
 */
const sendMessageAsUser = async (userToken, channelId, threadTs, body, url, userId) => {
  try {
    const userClient = new WebClient(userToken);
    
    // Format the body into blocks with proper code formatting
    const contentBlocks = formatCodeSnippets(body);
    
    // Add view button
    contentBlocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View on GitHub",
            emoji: true
          },
          url: url
        }
      ]
    });
    
    // Post message as the user
    const result = await userClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: contentBlocks,
      text: truncateText(body, 100), // Plain text fallback
      unfurl_links: false,
      unfurl_media: false
    });
    
    return result;
  } catch (error) {
    // If token is revoked, clear it from the database
    if (error.code === 'token_revoked' || error.code === 'invalid_auth') {
      try {
        if (userId) {
          await users.clearSlackToken(userId);
          console.log(`Cleared revoked Slack token for user ${userId}`);
        }
      } catch (clearError) {
        console.error('Error clearing revoked token:', clearError);
      }
    }
    throw error;
  }
};

/**
 * Send message as the bot on behalf of a user
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {Object} comment - Comment data
 * @returns {Promise<Object>} Result of message post
 */
const sendMessageAsBot = async (token, channelId, threadTs, comment) => {
  try {
    const client = new WebClient(token);
    const { author, authorSlackId, body, url } = comment;
    
    // If we have a Slack user ID, get their profile info
    let userProfile = null;
    if (authorSlackId) {
      try {
        const userInfo = await client.users.info({
          user: authorSlackId
        });
        userProfile = userInfo.user;
      } catch (profileError) {
        console.error('Error fetching user profile:', profileError);
      }
    }
    
    // Format the body into blocks with proper code formatting
    const contentBlocks = formatCodeSnippets(body);
    
    // Create base blocks array for the message
    const blocks = [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:bust_in_silhouette: *${author}* replied:`
          }
        ]
      }
    ];
    
    // Add the formatted content blocks
    blocks.push(...contentBlocks);
    
    // Add action button
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View on GitHub",
            emoji: true
          },
          url: url
        }
      ]
    });

    const messageParams = {
      channel: channelId,
      thread_ts: threadTs,
      blocks: blocks,
      text: `Reply from ${author}: ${truncateText(body, 50)}`,
      unfurl_links: false,
      unfurl_media: false
    };

    if (userProfile) {
      messageParams.username = userProfile.real_name || userProfile.name;
      messageParams.icon_url = userProfile.profile.image_72;
    }
    
    const result = await client.chat.postMessage(messageParams);
    return result;
  } catch (error) {
    console.error('Error sending as bot:', error);
    throw error;
  }
};


/**
 * Send a PR comment edited message to Slack with rich text code formatting
 * @param {string} token - Slack bot token
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Thread timestamp to reply to
 * @param {Object} data - Comment data
 * @returns {Promise<Object>} Slack message response
 */
const sendCommentEditedMessage = async (token, channelId, threadTs, data) => {
  const client = new WebClient(token);
  
  // Format the body into blocks with proper code formatting
  const contentBlocks = formatCodeSnippets(data.body);
  
  try {
    // Create base blocks array for the message
    const blocks = [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:pencil2: *${data.author}* edited their comment:`
          }
        ]
      }
    ];
    
    // Add the formatted content blocks
    blocks.push(...contentBlocks);
    
    // Add action button
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":link: View Comment",
            emoji: true
          },
          url: data.url
        }
      ]
    });
    
    return await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: blocks,
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
  
  // Format time open
  let timeOpenText = `${data.hoursOpen} hours`;
  if (data.daysOpen > 0) {
    timeOpenText = `${data.daysOpen} days`;
    if (data.hoursOpen % 24 > 0) {
      timeOpenText += ` and ${data.hoursOpen % 24} hours`;
    }
  }
  
  // Format reviewer mentions
  const formatReviewers = (reviewers) => {
    return reviewers.map(r => r.slackUserId ? `<@${r.slackUserId}>` : r.githubUsername).join(', ');
  };
  
  // Build appropriate message based on review status
  let statusText = '';
  let actionsText = '';
  
  if (data.changesRequestedReviewers.length > 0) {
    statusText = `This PR has changes requested by: ${formatReviewers(data.changesRequestedReviewers)}`;
    actionsText = 'Please address the requested changes.';
  } else if (data.approvedReviewers.length > 0 && data.pendingReviewers.length === 0) {
    statusText = `This PR has been approved by: ${formatReviewers(data.approvedReviewers)}`;
    actionsText = 'This PR is ready to be merged!';
  } else if (data.approvedReviewers.length > 0) {
    statusText = `This PR has been approved by: ${formatReviewers(data.approvedReviewers)}`;
    actionsText = `Still waiting for reviews from: ${formatReviewers(data.pendingReviewers)}`;
  } else if (data.pendingReviewers.length > 0) {
    statusText = 'This PR has no approvals yet.';
    actionsText = `Waiting for reviews from: ${formatReviewers(data.pendingReviewers)}`;
  } else {
    statusText = 'This PR has no reviewers assigned.';
    actionsText = 'Consider adding reviewers to move this PR forward.';
  }
  
  try {
    return await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `:alarm_clock: PR Reminder`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${data.url}|${data.title}>*`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:hourglass: *Open for:* ${timeOpenText}`
            }
          ]
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: statusText
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: actionsText
          }
        },
        {
          type: "divider"
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":link: View PR",
                emoji: true
              },
              url: data.url,
              style: "primary"
            }
          ]
        }
      ],
      text: `Reminder: PR #${data.prNumber} has been open for ${timeOpenText}`
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
          type: "header",
          text: {
            type: "plain_text",
            text: `:tada: PR Merged to Main Branch`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${data.url}|${data.title}>*`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:bust_in_silhouette: *Author:* ${data.author}`
            }
          ]
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:file_folder: *Repository:* ${data.repoName}`
            }
          ]
        },
        {
          type: "divider"
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: ":link: View PR",
                emoji: true
              },
              url: data.url
            }
          ]
        }
      ],
      text: `${data.author} merged PR: ${data.title} in ${data.repoName}`
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