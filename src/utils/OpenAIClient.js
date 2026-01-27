const OpenAI = require('openai');

class OpenAIClient {
  constructor(bot) {
    this.bot = bot;
    this.apiKey = process.env.OPENAI_API_KEY || null;
    this.client = null;
    if (this.apiKey) {
      try {
        this.client = new OpenAI({ apiKey: this.apiKey });
      } catch (e) {
        console.warn('[OpenAIClient] failed to initialize OpenAI client:', e.message);
        this.client = null;
      }
    }
  }

  available() {
    return !!this.client;
  }

  async chat(prompt, options = {}) {
    if (!this.client) throw new Error('OpenAI client not available');
    const model = options.model || 'gpt-4o-mini';
    const maxTokens = options.maxTokens || 800;
    const temperature = options.temperature ?? 0.2;

    const response = await this.client.responses.create({
      model,
      input: prompt,
      temperature,
      max_tokens: maxTokens
    });

    if (!response || !response.output || !response.output[0]) return '';
    // response.output can be array of content objects
    return response.output.map(o => (o.content?.[0]?.text || '')).join('\n');
  }
}

module.exports = OpenAIClient;
