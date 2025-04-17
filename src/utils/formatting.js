/**
 * Formatting utilities
 * Helper functions for text formatting
 */

/**
 * Truncate text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
const truncateText = (text, maxLength) => {
    if (!text) return '';
    
    if (text.length <= maxLength) {
      return text;
    }
    
    return text.substring(0, maxLength - 3) + '...';
  };
  
  /**
   * Format PR description for Slack
   * @param {string} description - PR description
   * @param {number} maxLength - Maximum length
   * @returns {string} Formatted description
   */
  const formatPrDescription = (description, maxLength = 300) => {
    if (!description) return '_No description provided_';
    
    // Replace any markdown links with plain text links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const plainDescription = description.replace(linkRegex, '$1 ($2)');
    
    // Clean up markdown for Slack
    const cleanDescription = plainDescription
      .replace(/#{1,6}\s+/g, '*') // Headers to bold
      .replace(/(\*\*|__)(.*?)\1/g, '*$2*') // Bold to Slack bold
      .replace(/(\*|_)(.*?)\1/g, '$1$2$1'); // Keep italics as is
    
    return truncateText(cleanDescription, maxLength);
  };
  
  /**
   * Format code block for Slack
   * @param {string} code - Code to format
   * @returns {string} Formatted code block
   */
  const formatCodeBlock = (code) => {
    if (!code) return '';
    
    // Clean up the diff hunk for display
    // Remove leading + or - from all lines to avoid Slack formatting issues
    const cleanedCode = code
      .split('\n')
      .map(line => {
        if (line.startsWith('+')) {
          return `• ${line.substring(1)}`;
        } else if (line.startsWith('-')) {
          return `× ${line.substring(1)}`;
        } else if (line.startsWith('@@ ')) {
          return ''; // Remove diff header lines
        }
        return line;
      })
      .filter(Boolean) // Remove empty lines
      .join('\n');
    
    // Return as Slack code block
    return '```\n' + cleanedCode + '\n```';
  };
  
  /**
   * Create a sanitized channel name
   * @param {string} text - Text to convert to channel name
   * @returns {string} Sanitized channel name
   */
  const createChannelName = (text) => {
    if (!text) return 'channel';
    
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .substring(0, 80); // Limit length to 80 chars
  };
  
  /**
   * Format a GitHub username for display
   * @param {string} username - GitHub username
   * @returns {string} Formatted username
   */
  const formatGitHubUsername = (username) => {
    if (!username) return '';
    
    return `@${username}`;
  };
  
  /**
   * Format time elapsed
   * @param {Date|string} date - Date to calculate elapsed time from
   * @returns {string} Formatted elapsed time
   */
  const formatTimeElapsed = (date) => {
    if (!date) return '';
    
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    
    // Convert to appropriate unit
    const diffSecs = Math.round(diffMs / 1000);
    if (diffSecs < 60) return `${diffSecs} seconds ago`;
    
    const diffMins = Math.round(diffSecs / 60);
    if (diffMins < 60) return `${diffMins} minutes ago`;
    
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} days ago`;
  };
  
  module.exports = {
    truncateText,
    formatPrDescription,
    formatCodeBlock,
    createChannelName,
    formatGitHubUsername,
    formatTimeElapsed
  };