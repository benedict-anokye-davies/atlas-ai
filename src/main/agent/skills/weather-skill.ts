/**
 * Atlas Desktop - Weather Skill
 *
 * Provides weather information and forecasts.
 *
 * NOTE: This skill currently uses mock data. To enable real weather data:
 * 1. Sign up for OpenWeatherMap API (https://openweathermap.org/api)
 * 2. Add OPENWEATHERMAP_API_KEY to your .env file
 * 3. The skill will automatically use real data when the key is present
 *
 * @see https://openweathermap.org/api for API documentation
 */

import { BaseSkill } from './base-skill';
import type {
  SkillMetadata,
  SkillTrigger,
  SkillCapabilities,
  SkillContext,
  SkillResult,
} from '../../../shared/types/skill';
import type { AgentTool } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';

const logger = createModuleLogger('weather-skill');

// Weather API configuration (set via environment variables)
const WEATHER_API_KEY = process.env.OPENWEATHERMAP_API_KEY;
const WEATHER_API_BASE = 'https://api.openweathermap.org/data/2.5';
const USE_REAL_API = !!WEATHER_API_KEY;

/**
 * Weather data structure
 */
interface WeatherData {
  location: string;
  temperature: number;
  unit: 'celsius' | 'fahrenheit';
  condition: string;
  humidity: number;
  windSpeed: number;
  windUnit: string;
  feelsLike: number;
  forecast?: DayForecast[];
}

/**
 * Daily forecast
 */
interface DayForecast {
  day: string;
  high: number;
  low: number;
  condition: string;
}

/**
 * Weather Skill
 * Provides weather information (stub for API integration)
 */
export class WeatherSkill extends BaseSkill {
  readonly id = 'weather';

  readonly metadata: SkillMetadata = {
    displayName: 'Weather',
    description: 'Get weather information and forecasts',
    longDescription:
      'Check current weather conditions and forecasts for any location. Get temperature, humidity, wind speed, and more.',
    version: '1.0.0',
    icon: 'cloud',
    category: 'information',
    tags: ['weather', 'temperature', 'forecast', 'rain', 'sun', 'climate'],
    exampleQueries: [
      "What's the weather like?",
      'Weather in New York',
      'Is it going to rain today?',
      "What's the temperature outside?",
      "What's the forecast for this week?",
      'Do I need an umbrella?',
    ],
    builtIn: true,
  };

  readonly triggers: SkillTrigger[] = [
    {
      type: 'keyword',
      keywords: [
        'weather',
        'temperature',
        'forecast',
        'rain',
        'sunny',
        'cloudy',
        'snow',
        'humid',
        'umbrella',
        'outside',
        'cold',
        'hot',
        'warm',
      ],
      priority: 1,
    },
    {
      type: 'intent',
      intents: ['get_weather', 'check_forecast', 'temperature_check'],
      priority: 1,
    },
  ];

  readonly capabilities: SkillCapabilities = {
    required: ['conversation'],
    optional: ['web_search'],
    requiresInternet: true,
    offlineCapable: false,
  };

  // Default location (can be configured)
  private defaultLocation: string = 'your area';

  /**
   * Check if should handle
   */
  async shouldHandle(context: SkillContext): Promise<number> {
    const query = context.query.toLowerCase();

    // High confidence for direct weather questions
    if (/\bweather\b/.test(query)) {
      return 0.9;
    }

    if (/\b(temperature|forecast)\b/.test(query)) {
      return 0.85;
    }

    // Weather-related questions
    if (/\b(rain|snow|sunny|cloudy)\b.*\b(today|tomorrow|week)\b/.test(query)) {
      return 0.8;
    }

    if (/\bdo i need (an? )?(umbrella|jacket|coat)\b/.test(query)) {
      return 0.75;
    }

    if (/\b(is it|will it be)\s+(hot|cold|warm|raining|snowing)\b/.test(query)) {
      return 0.75;
    }

    return super.shouldHandle(context);
  }

  /**
   * Execute weather query
   */
  async execute(context: SkillContext): Promise<SkillResult> {
    logger.info(`[Weather] Processing query: ${context.query}`);

    const query = context.query.toLowerCase();

    try {
      // Extract location from query
      const location = this.extractLocation(query) || this.defaultLocation;

      // Check what type of weather info is being requested
      if (/\bforecast\b/.test(query) || /\bweek\b/.test(query)) {
        return this.getForecast(location);
      }

      if (/\b(rain|umbrella)\b/.test(query)) {
        return this.checkForRain(location);
      }

      // Default: current weather
      return this.getCurrentWeather(location);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`[Weather] Error: ${errorMessage}`);
      return this.failure(errorMessage);
    }
  }

  /**
   * Get current weather
   * Uses OpenWeatherMap API when API key is available, otherwise falls back to mock data
   */
  private async getCurrentWeather(location: string): Promise<SkillResult> {
    try {
      if (USE_REAL_API) {
        const weather = await this.fetchRealWeather(location);
        const response = this.formatCurrentWeather(weather);
        return this.success(weather, response);
      } else {
        // Fallback to mock data when no API key
        const mockWeather = this.getMockWeather(location);
        const response = this.formatCurrentWeather(mockWeather);
        return this.success(mockWeather, response);
      }
    } catch (error) {
      logger.error('Failed to fetch weather', { error, location });
      // Fallback to mock data on error
      const mockWeather = this.getMockWeather(location);
      const response = this.formatCurrentWeather(mockWeather);
      return this.success(mockWeather, response);
    }
  }

  /**
   * Get weather forecast
   * Uses OpenWeatherMap API when API key is available, otherwise falls back to mock data
   */
  private async getForecast(location: string): Promise<SkillResult> {
    try {
      if (USE_REAL_API) {
        const weather = await this.fetchRealWeather(location);
        weather.forecast = await this.fetchRealForecast(location);
        const response = this.formatForecast(weather);
        return this.success(weather, response);
      } else {
        // Fallback to mock data when no API key
        const mockWeather = this.getMockWeather(location);
        mockWeather.forecast = this.getMockForecast();
        const response = this.formatForecast(mockWeather);
        return this.success(mockWeather, response);
      }
    } catch (error) {
      logger.error('Failed to fetch forecast', { error, location });
      // Fallback to mock data on error
      const mockWeather = this.getMockWeather(location);
      mockWeather.forecast = this.getMockForecast();
      const response = this.formatForecast(mockWeather);
      return this.success(mockWeather, response);
    }
  }

  /**
   * Check for rain
   */
  private async checkForRain(location: string): Promise<SkillResult> {
    try {
      let weather: WeatherData;

      if (USE_REAL_API) {
        weather = await this.fetchRealWeather(location);
      } else {
        weather = this.getMockWeather(location);
      }

      const willRain =
        weather.condition.toLowerCase().includes('rain') ||
        weather.condition.toLowerCase().includes('storm') ||
        weather.condition.toLowerCase().includes('drizzle');

      const response = willRain
        ? `Yes, it looks like ${weather.condition.toLowerCase()} is expected in ${location}. You might want to bring an umbrella.`
        : `No rain is expected in ${location} right now. You should be fine without an umbrella.`;

      return this.success({ willRain, weather }, response);
    } catch (error) {
      logger.error('Failed to check for rain', { error, location });
      // Fallback to mock data
      const mockWeather = this.getMockWeather(location);
      const willRain =
        mockWeather.condition.toLowerCase().includes('rain') ||
        mockWeather.condition.toLowerCase().includes('storm');

      const response = willRain
        ? `Yes, it looks like rain is expected in ${location}. You might want to bring an umbrella.`
        : `No rain is expected in ${location} right now. You should be fine without an umbrella.`;

      return this.success({ willRain, weather: mockWeather }, response);
    }
  }

  /**
   * Extract location from query
   */
  private extractLocation(query: string): string | null {
    // Common patterns for location extraction
    const patterns = [
      /weather (?:in|for|at) ([a-zA-Z\s,]+?)(?:\?|$|today|tomorrow|this week)/i,
      /(?:in|for|at) ([a-zA-Z\s,]+?)(?:'s)? weather/i,
      /([a-zA-Z\s,]+?) weather/i,
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match && match[1]) {
        const location = match[1].trim();
        // Filter out common non-location words
        if (!['the', 'my', 'your', 'our', 'their'].includes(location.toLowerCase())) {
          return location;
        }
      }
    }

    return null;
  }

  /**
   * Fetch real weather data from OpenWeatherMap API
   */
  private async fetchRealWeather(location: string): Promise<WeatherData> {
    if (!WEATHER_API_KEY) {
      throw new Error('OpenWeatherMap API key not configured');
    }

    // First, geocode the location to get coordinates
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${WEATHER_API_KEY}`;

    const geoResponse = await fetch(geoUrl);
    if (!geoResponse.ok) {
      throw new Error(`Geocoding failed: ${geoResponse.status}`);
    }

    const geoData = (await geoResponse.json()) as Array<{
      lat: number;
      lon: number;
      name: string;
      country: string;
    }>;

    if (!geoData || geoData.length === 0) {
      throw new Error(`Location not found: ${location}`);
    }

    const { lat, lon, name } = geoData[0];

    // Fetch current weather
    const weatherUrl = `${WEATHER_API_BASE}/weather?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;

    const weatherResponse = await fetch(weatherUrl);
    if (!weatherResponse.ok) {
      throw new Error(`Weather API error: ${weatherResponse.status}`);
    }

    const weatherData = (await weatherResponse.json()) as {
      main: {
        temp: number;
        feels_like: number;
        humidity: number;
      };
      weather: Array<{
        main: string;
        description: string;
      }>;
      wind: {
        speed: number;
      };
      name: string;
    };

    return {
      location: name || location,
      temperature: Math.round(weatherData.main.temp),
      unit: 'celsius',
      condition: this.capitalizeFirst(weatherData.weather[0]?.description || 'Unknown'),
      humidity: weatherData.main.humidity,
      windSpeed: Math.round(weatherData.wind.speed * 3.6), // Convert m/s to km/h
      windUnit: 'km/h',
      feelsLike: Math.round(weatherData.main.feels_like),
    };
  }

  /**
   * Fetch real weather forecast from OpenWeatherMap API
   */
  private async fetchRealForecast(location: string): Promise<DayForecast[]> {
    if (!WEATHER_API_KEY) {
      throw new Error('OpenWeatherMap API key not configured');
    }

    // First, geocode the location
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${WEATHER_API_KEY}`;

    const geoResponse = await fetch(geoUrl);
    if (!geoResponse.ok) {
      throw new Error(`Geocoding failed: ${geoResponse.status}`);
    }

    const geoData = (await geoResponse.json()) as Array<{
      lat: number;
      lon: number;
    }>;

    if (!geoData || geoData.length === 0) {
      throw new Error(`Location not found: ${location}`);
    }

    const { lat, lon } = geoData[0];

    // Fetch 5-day forecast
    const forecastUrl = `${WEATHER_API_BASE}/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;

    const forecastResponse = await fetch(forecastUrl);
    if (!forecastResponse.ok) {
      throw new Error(`Forecast API error: ${forecastResponse.status}`);
    }

    const forecastData = (await forecastResponse.json()) as {
      list: Array<{
        dt: number;
        main: {
          temp_min: number;
          temp_max: number;
        };
        weather: Array<{
          main: string;
          description: string;
        }>;
      }>;
    };

    // Group by day and get daily highs/lows
    const dailyData = new Map<string, { min: number; max: number; condition: string }>();

    for (const item of forecastData.list) {
      const date = new Date(item.dt * 1000);
      const dayKey = date.toLocaleDateString('en-US', { weekday: 'long' });

      if (!dailyData.has(dayKey)) {
        dailyData.set(dayKey, {
          min: item.main.temp_min,
          max: item.main.temp_max,
          condition: this.capitalizeFirst(item.weather[0]?.description || 'Unknown'),
        });
      } else {
        const existing = dailyData.get(dayKey)!;
        existing.min = Math.min(existing.min, item.main.temp_min);
        existing.max = Math.max(existing.max, item.main.temp_max);
      }
    }

    // Convert to DayForecast array (limit to 5 days)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date().getDay();
    const result: DayForecast[] = [];

    for (let i = 0; i < 5; i++) {
      const dayIndex = (today + i) % 7;
      const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : days[dayIndex];
      const data = dailyData.get(days[dayIndex]);

      if (data) {
        result.push({
          day: dayName,
          high: Math.round(data.max),
          low: Math.round(data.min),
          condition: data.condition,
        });
      }
    }

    return result;
  }

  /**
   * Capitalize first letter of a string
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Get mock weather data (fallback when API unavailable)
   */
  private getMockWeather(location: string): WeatherData {
    // Generate somewhat realistic mock data
    const conditions = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Clear'];
    const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
    const baseTemp = 20 + Math.floor(Math.random() * 15); // 20-35 Celsius

    return {
      location,
      temperature: baseTemp,
      unit: 'celsius',
      condition: randomCondition,
      humidity: 40 + Math.floor(Math.random() * 40), // 40-80%
      windSpeed: 5 + Math.floor(Math.random() * 20), // 5-25 km/h
      windUnit: 'km/h',
      feelsLike: baseTemp + Math.floor(Math.random() * 5) - 2,
    };
  }

  /**
   * Get mock forecast
   */
  private getMockForecast(): DayForecast[] {
    const days = ['Today', 'Tomorrow', 'Wednesday', 'Thursday', 'Friday'];
    const conditions = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Clear'];

    return days.map((day) => ({
      day,
      high: 22 + Math.floor(Math.random() * 10),
      low: 15 + Math.floor(Math.random() * 5),
      condition: conditions[Math.floor(Math.random() * conditions.length)],
    }));
  }

  /**
   * Format current weather response
   */
  private formatCurrentWeather(weather: WeatherData): string {
    const tempDisplay = `${weather.temperature}°${weather.unit === 'celsius' ? 'C' : 'F'}`;
    const feelsLikeDisplay = `${weather.feelsLike}°${weather.unit === 'celsius' ? 'C' : 'F'}`;

    return (
      `Currently in ${weather.location}: ${weather.condition}, ${tempDisplay}. ` +
      `Feels like ${feelsLikeDisplay}. ` +
      `Humidity: ${weather.humidity}%. Wind: ${weather.windSpeed} ${weather.windUnit}.`
    );
  }

  /**
   * Format forecast response
   */
  private formatForecast(weather: WeatherData): string {
    if (!weather.forecast) {
      return this.formatCurrentWeather(weather);
    }

    const forecastLines = weather.forecast.map(
      (day) => `${day.day}: ${day.condition}, ${day.high}°/${day.low}°`
    );

    return `Weather forecast for ${weather.location}:\n` + forecastLines.join('\n');
  }

  /**
   * Update configuration
   */
  async updateConfig(
    config: Partial<import('../../../shared/types/skill').SkillConfig>
  ): Promise<void> {
    await super.updateConfig(config);

    // Check for default location setting
    if (config.settings?.defaultLocation) {
      this.defaultLocation = config.settings.defaultLocation as string;
    }
  }

  /**
   * Register weather tools
   */
  protected registerTools(): AgentTool[] {
    return [
      {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City or location name',
            },
          },
          required: ['location'],
        },
        execute: async (params: Record<string, unknown>) => {
          const location = params.location as string;
          const weather = this.getMockWeather(location);
          return {
            success: true,
            data: weather,
          };
        },
      },
      {
        name: 'get_forecast',
        description: 'Get weather forecast for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City or location name',
            },
            days: {
              type: 'number',
              description: 'Number of days (default 5)',
            },
          },
          required: ['location'],
        },
        execute: async (params: Record<string, unknown>) => {
          const location = params.location as string;
          const weather = this.getMockWeather(location);
          weather.forecast = this.getMockForecast();
          return {
            success: true,
            data: weather,
          };
        },
      },
    ];
  }
}

export default WeatherSkill;
