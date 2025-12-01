const { subDays, startOfDay, endOfDay, format, addDays } = require('date-fns');
const firestoreDb = require('./firestoreService');

class AdvancedAnalyticsService {
  /**
   * Goal Tracking System
   */
  
  // Create a new goal for a business
  async createGoal(businessId, goalData) {
    try {
      const goal = await firestoreDb.goal.create({
        businessId,
        title: goalData.title,
        description: goalData.description,
        type: goalData.type,
        targetValue: goalData.targetValue,
        currentValue: 0,
        progressPercent: 0,
        targetDate: new Date(goalData.targetDate),
        priority: goalData.priority || 'MEDIUM',
        status: 'ACTIVE'
      });

      // Create default milestones (25%, 50%, 75%, 100%)
      const milestones = [
        { title: '25% Complete', value: Math.floor(goalData.targetValue * 0.25) },
        { title: '50% Complete', value: Math.floor(goalData.targetValue * 0.5) },
        { title: '75% Complete', value: Math.floor(goalData.targetValue * 0.75) },
        { title: 'Goal Complete', value: goalData.targetValue }
      ];

      await Promise.all(
        milestones.map(milestone =>
          firestoreDb.milestone.create({
            goalId: goal.id,
            title: milestone.title,
            value: milestone.value,
            achieved: false
          })
        )
      );

      // Get the created milestones
      const createdMilestones = await firestoreDb.milestone.findByGoalId(goal.id);

      return { ...goal, milestones: createdMilestones };
    } catch (error) {
      console.error('Error creating goal:', error);
      throw new Error('Failed to create goal');
    }
  }

  // Get goals for a business
  async getBusinessGoals(businessId, status = 'ACTIVE') {
    try {
      let goals = await firestoreDb.goal.findMany({
        where: { businessId }
      });

      // Filter by status if not 'ALL'
      if (status !== 'ALL') {
        goals = goals.filter(g => g.status === status);
      }

      // Sort by createdAt descending
      goals.sort((a, b) => b.createdAt - a.createdAt);

      // Update goal progress
      const updatedGoals = await Promise.all(
        goals.map(async (goal) => {
          const currentValue = await this.calculateGoalProgress(businessId, goal.type);
          const progressPercent = Math.min((currentValue / goal.targetValue) * 100, 100);
          
          // Check if goal is completed
          const isCompleted = currentValue >= goal.targetValue;
          const goalStatus = isCompleted && goal.status === 'ACTIVE' ? 'COMPLETED' : goal.status;
          
          // Get milestones
          const milestones = await firestoreDb.milestone.findByGoalId(goal.id);
          
          // Update milestones
          const updatedMilestones = milestones.map(milestone => ({
            ...milestone,
            achieved: currentValue >= milestone.value
          }));

          // Update goal in database if needed
          if (progressPercent !== goal.progressPercent || currentValue !== goal.currentValue || goalStatus !== goal.status) {
            await firestoreDb.goal.update(
              { id: goal.id },
              {
                currentValue,
                progressPercent,
                status: goalStatus,
                ...(isCompleted && !goal.completedAt && { completedAt: new Date() })
              }
            );
          }

          return {
            ...goal,
            currentValue,
            progressPercent,
            status: goalStatus,
            milestones: updatedMilestones
          };
        })
      );

      return updatedGoals;
    } catch (error) {
      console.error('Error getting business goals:', error);
      throw new Error('Failed to get business goals');
    }
  }

  // Calculate current progress for a goal type
  async calculateGoalProgress(businessId, goalType) {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);
    const now = new Date();

    try {
      switch (goalType) {
        case 'REVIEWS':
          const reviews = await firestoreDb.review.findMany({
            where: {
              businessId,
              createdAt: { gte: startOfYear, lte: now }
            }
          });
          return reviews.length;

        case 'QR_SCANS':
          // Get all QR codes for this business
          const qrCodes = await firestoreDb.qrCode.findMany({
            where: { businessId }
          });
          let totalScans = 0;
          for (const qr of qrCodes) {
            const scans = await firestoreDb.qrScan.findMany({
              where: {
                qrCodeId: qr.id,
                scannedAt: { gte: startOfYear, lte: now }
              }
            });
            totalScans += scans.length;
          }
          return totalScans;

        case 'CUSTOMERS':
          const customers = await firestoreDb.customer.findMany({
            where: {
              businessId,
              createdAt: { gte: startOfYear, lte: now }
            }
          });
          return customers.length;

        case 'RATING':
          const allReviews = await firestoreDb.review.findMany({
            where: {
              businessId,
              createdAt: { gte: startOfYear, lte: now }
            }
          });
          const reviewsWithRating = allReviews.filter(r => r.rating != null);
          if (reviewsWithRating.length === 0) return 0;
          const avgRating = reviewsWithRating.reduce((sum, r) => sum + r.rating, 0) / reviewsWithRating.length;
          return Math.round(avgRating * 10); // Convert to scale of 50 (5.0 * 10)

        default:
          return 0;
      }
    } catch (error) {
      console.error('Error calculating goal progress:', error);
      return 0;
    }
  }

  /**
   * Automated Insights Engine
   */
  
  // Generate insights for a business
  async generateBusinessInsights(businessId) {
    try {
      const insights = [];
      
      // Performance insights
      const performanceInsights = await this.generatePerformanceInsights(businessId);
      insights.push(...performanceInsights);
      
      // Trend insights
      const trendInsights = await this.generateTrendInsights(businessId);
      insights.push(...trendInsights);
      
      // Recommendation insights
      const recommendations = await this.generateRecommendations(businessId);
      insights.push(...recommendations);

      // Save insights to database
      const savedInsights = await Promise.all(
        insights.map(insight =>
          firestoreDb.insight.create({
            businessId,
            type: insight.type,
            category: insight.category,
            title: insight.title,
            description: insight.description,
            severity: insight.severity,
            actionable: insight.actionable,
            data: JSON.stringify(insight.data),
            confidence: insight.confidence
          })
        )
      );

      return savedInsights;
    } catch (error) {
      console.error('Error generating business insights:', error);
      throw new Error('Failed to generate insights');
    }
  }

  // Generate performance insights
  async generatePerformanceInsights(businessId) {
    const insights = [];
    const last30Days = subDays(new Date(), 30);
    const last60Days = subDays(new Date(), 60);

    try {
      // Review performance
      const allReviews = await firestoreDb.review.findMany({
        where: { businessId }
      });

      const recentReviews = allReviews.filter(r => r.createdAt >= last30Days).length;
      const previousReviews = allReviews.filter(r => r.createdAt >= last60Days && r.createdAt < last30Days).length;

      const reviewGrowth = previousReviews > 0 ? ((recentReviews - previousReviews) / previousReviews * 100) : 0;

      if (reviewGrowth > 20) {
        insights.push({
          type: 'PERFORMANCE',
          category: 'REVIEWS',
          title: 'Excellent Review Growth',
          description: `Your reviews increased by ${reviewGrowth.toFixed(1)}% this month! Keep up the great work.`,
          severity: 'SUCCESS',
          actionable: false,
          confidence: 0.9,
          data: { growth: reviewGrowth, current: recentReviews, previous: previousReviews }
        });
      } else if (reviewGrowth < -10) {
        insights.push({
          type: 'ALERT',
          category: 'REVIEWS',
          title: 'Review Collection Declining',
          description: `Your reviews decreased by ${Math.abs(reviewGrowth).toFixed(1)}% this month. Consider increasing QR code visibility.`,
          severity: 'WARNING',
          actionable: true,
          confidence: 0.8,
          data: { growth: reviewGrowth, current: recentReviews, previous: previousReviews }
        });
      }

      // QR code performance
      const qrCodes = await firestoreDb.qrCode.findMany({
        where: { businessId }
      });

      let recentScans = 0;
      let previousScans = 0;
      
      for (const qr of qrCodes) {
        const allScans = await firestoreDb.qrScan.findMany({
          where: { qrCodeId: qr.id }
        });
        recentScans += allScans.filter(s => s.scannedAt >= last30Days).length;
        previousScans += allScans.filter(s => s.scannedAt >= last60Days && s.scannedAt < last30Days).length;
      }

      const scanGrowth = previousScans > 0 ? ((recentScans - previousScans) / previousScans * 100) : 0;

      if (scanGrowth > 30) {
        insights.push({
          type: 'PERFORMANCE',
          category: 'QR_CODES',
          title: 'QR Code Engagement Rising',
          description: `QR code scans increased by ${scanGrowth.toFixed(1)}% this month. Your QR placement strategy is working!`,
          severity: 'SUCCESS',
          actionable: false,
          confidence: 0.85,
          data: { growth: scanGrowth, current: recentScans, previous: previousScans }
        });
      }

      return insights;
    } catch (error) {
      console.error('Error generating performance insights:', error);
      return [];
    }
  }

  // Generate trend insights
  async generateTrendInsights(businessId) {
    const insights = [];

    try {
      // Analyze best review collection days
      const reviews = await firestoreDb.review.findMany({
        where: {
          businessId,
          createdAt: { gte: subDays(new Date(), 30) }
        }
      });

      // Group reviews by day
      const reviewsByDay = reviews.map(review => ({
        createdAt: review.createdAt,
        _count: { id: 1 }
      }));

      // Analyze patterns
      const dayAnalysis = this.analyzeDayPatterns(reviewsByDay);
      
      if (dayAnalysis.bestDay && dayAnalysis.averageReviews > 0) {
        insights.push({
          type: 'TREND',
          category: 'REVIEWS',
          title: `${dayAnalysis.bestDay}s Are Your Best Review Days`,
          description: `You get ${dayAnalysis.averageReviews} more reviews on ${dayAnalysis.bestDay}s. Consider promoting QR codes more on these days.`,
          severity: 'INFO',
          actionable: true,
          confidence: 0.7,
          data: dayAnalysis
        });
      }

      return insights;
    } catch (error) {
      console.error('Error generating trend insights:', error);
      return [];
    }
  }

  // Generate recommendations
  async generateRecommendations(businessId) {
    const recommendations = [];

    try {
      // Check if business has QR codes
      const qrCodes = await firestoreDb.qrCode.findMany({
        where: { businessId }
      });

      if (qrCodes.length === 0) {
        recommendations.push({
          type: 'RECOMMENDATION',
          category: 'QR_CODES',
          title: 'Create Your First QR Code',
          description: 'QR codes can increase review collection by 300%. Create one today to start gathering more reviews!',
          severity: 'INFO',
          actionable: true,
          confidence: 0.9,
          data: { action: 'CREATE_QR_CODE' }
        });
      }

      // Check review response rate
      let totalScans = 0;
      for (const qr of qrCodes) {
        const scans = await firestoreDb.qrScan.count({ qrCodeId: qr.id });
        totalScans += scans;
      }
      
      const totalReviews = await firestoreDb.review.count({ businessId });

      const conversionRate = totalScans > 0 ? (totalReviews / totalScans) * 100 : 0;

      if (conversionRate < 10 && totalScans > 10) {
        recommendations.push({
          type: 'RECOMMENDATION',
          category: 'REVIEWS',
          title: 'Improve Review Conversion Rate',
          description: `Only ${conversionRate.toFixed(1)}% of QR scans result in reviews. Try simplifying your review form or offering incentives.`,
          severity: 'WARNING',
          actionable: true,
          confidence: 0.8,
          data: { conversionRate, totalScans, totalReviews }
        });
      }

      return recommendations;
    } catch (error) {
      console.error('Error generating recommendations:', error);
      return [];
    }
  }

  // Analyze day patterns (simplified)
  analyzeDayPatterns(reviewsByDay) {
    const dayCount = {};
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    reviewsByDay.forEach(review => {
      const day = days[new Date(review.createdAt).getDay()];
      dayCount[day] = (dayCount[day] || 0) + (review._count?.id || 1);
    });

    const bestDay = Object.keys(dayCount).length > 0 
      ? Object.keys(dayCount).reduce((a, b) => dayCount[a] > dayCount[b] ? a : b, 'Monday')
      : null;
    const averageReviews = bestDay ? (dayCount[bestDay] || 0) : 0;

    return { bestDay, averageReviews, dayCount };
  }

  /**
   * Industry Benchmarking
   */
  
  // Get industry benchmarks
  async getIndustryBenchmarks(industry = 'GENERAL') {
    try {
      const benchmarks = await firestoreDb.benchmark.findMany({
        where: { industry }
      });

      // If no specific industry data, fall back to general benchmarks
      if (benchmarks.length === 0 && industry !== 'GENERAL') {
        return await this.getIndustryBenchmarks('GENERAL');
      }

      // If still no benchmarks, return defaults
      if (benchmarks.length === 0) {
        return this.getDefaultBenchmarks();
      }

      return benchmarks;
    } catch (error) {
      console.error('Error getting industry benchmarks:', error);
      return this.getDefaultBenchmarks();
    }
  }

  // Get default benchmarks
  getDefaultBenchmarks() {
    return [
      {
        industry: 'GENERAL',
        metricType: 'AVERAGE_REVIEWS',
        value: 15,
        period: 'MONTHLY',
        sampleSize: 1000
      },
      {
        industry: 'GENERAL',
        metricType: 'AVERAGE_RATING',
        value: 4.2,
        period: 'MONTHLY',
        sampleSize: 1000
      },
      {
        industry: 'GENERAL',
        metricType: 'QR_SCAN_RATE',
        value: 12,
        period: 'MONTHLY',
        sampleSize: 500
      }
    ];
  }

  // Compare business performance to industry benchmarks
  async compareToIndustry(businessId, industry = 'GENERAL') {
    try {
      const benchmarks = await this.getIndustryBenchmarks(industry);
      const last30Days = subDays(new Date(), 30);

      // Get business metrics
      const reviews = await firestoreDb.review.findMany({
        where: {
          businessId,
          createdAt: { gte: last30Days }
        }
      });

      const reviewsWithRating = reviews.filter(r => r.rating != null);
      const avgRating = reviewsWithRating.length > 0
        ? reviewsWithRating.reduce((sum, r) => sum + r.rating, 0) / reviewsWithRating.length
        : 0;

      // Get QR scans
      const qrCodes = await firestoreDb.qrCode.findMany({
        where: { businessId }
      });
      
      let qrScans = 0;
      for (const qr of qrCodes) {
        const scans = await firestoreDb.qrScan.findMany({
          where: {
            qrCodeId: qr.id,
            scannedAt: { gte: last30Days }
          }
        });
        qrScans += scans.length;
      }

      const comparison = {};

      benchmarks.forEach(benchmark => {
        let businessValue = 0;
        let performanceLevel = 'average';

        switch (benchmark.metricType) {
          case 'AVERAGE_REVIEWS':
            businessValue = reviews.length;
            break;
          case 'AVERAGE_RATING':
            businessValue = avgRating;
            break;
          case 'QR_SCAN_RATE':
            businessValue = qrScans;
            break;
        }

        const percentageVsIndustry = benchmark.value > 0 ? ((businessValue - benchmark.value) / benchmark.value) * 100 : 0;
        
        if (percentageVsIndustry > 20) performanceLevel = 'excellent';
        else if (percentageVsIndustry > 0) performanceLevel = 'above_average';
        else if (percentageVsIndustry > -20) performanceLevel = 'average';
        else performanceLevel = 'below_average';

        comparison[benchmark.metricType] = {
          businessValue,
          industryAverage: benchmark.value,
          percentageVsIndustry: percentageVsIndustry.toFixed(1),
          performanceLevel,
          sampleSize: benchmark.sampleSize
        };
      });

      return comparison;
    } catch (error) {
      console.error('Error comparing to industry:', error);
      return {};
    }
  }

  /**
   * Custom Dashboard Widgets
   */
  
  // Get available widgets
  getAvailableWidgets() {
    return [
      {
        id: 'overview_stats',
        name: 'Overview Statistics',
        description: 'Key metrics at a glance',
        category: 'overview'
      },
      {
        id: 'goals_progress',
        name: 'Goals Progress',
        description: 'Track your business goals',
        category: 'goals'
      },
      {
        id: 'review_trends',
        name: 'Review Trends',
        description: 'Review collection over time',
        category: 'charts'
      },
      {
        id: 'qr_performance',
        name: 'QR Code Performance',
        description: 'QR code scan analytics',
        category: 'charts'
      },
      {
        id: 'industry_comparison',
        name: 'Industry Comparison',
        description: 'Compare with industry averages',
        category: 'benchmarks'
      },
      {
        id: 'recent_insights',
        name: 'Recent Insights',
        description: 'Latest automated insights',
        category: 'insights'
      }
    ];
  }

  // Get insights for a business
  async getBusinessInsights(businessId, limit = 10) {
    try {
      let insights = await firestoreDb.insight.findMany({
        where: { businessId }
      });

      // Sort by createdAt descending and limit
      insights = insights
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      return insights.map(insight => ({
        ...insight,
        data: insight.data ? JSON.parse(insight.data) : null
      }));
    } catch (error) {
      console.error('Error getting business insights:', error);
      return [];
    }
  }
}

module.exports = AdvancedAnalyticsService;
