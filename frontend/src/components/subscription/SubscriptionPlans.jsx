import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SubscriptionPlans = ({ currentPlan = 'Free', onPlanSelect }) => {
  const [billingCycle, setBillingCycle] = useState('monthly');

  const navigate = useNavigate();

  const handleSelectPlan = async (plan) => {
    if (plan.id === currentPlan) return; // Already on this plan
    
    try {
      // Navigate to checkout page with plan details
      navigate(`/checkout?plan=${plan.name}&billing=${plan.billing}&price=${plan.price}`);
    } catch (err) {
      console.error('Error selecting plan:', err);
    }
  };

  const getPlanFeatures = () => {
    return [
      'Unlimited AI-enhanced reviews',
      'Advanced analytics dashboard',
      'QR code generation',
      'Custom review templates',
      'Priority support',
      'Export capabilities',
      'Custom branding',
      'Advanced integrations'
    ];
  };

  const isCurrentPlan = (planId) => {
    return planId === currentPlan;
  };

  const getPrice = () => {
    if (billingCycle === 'monthly') {
      return { amount: '₹149', period: 'per month' };
    } else {
      return { amount: '₹99', period: 'per month', note: 'Billed yearly (₹1,188/year)' };
    }
  };

  const getSavings = () => {
    if (billingCycle === 'yearly') {
      const yearlyTotal = 99 * 12; // 1188
      const monthlyTotal = 149 * 12; // 1788
      const savings = monthlyTotal - yearlyTotal;
      return `Save ₹${savings} per year`;
    }
    return null;
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent mb-2 sm:mb-4">Choose Your Plan</h2>
        <p className="text-sm sm:text-base lg:text-lg text-gray-600 font-medium">Get access to all premium features</p>
      </div>

      {/* Billing Toggle - Mobile optimized */}
      <div className="flex justify-center mb-6 sm:mb-8">
        <div className="bg-white/80 backdrop-blur-sm p-1 sm:p-2 rounded-xl sm:rounded-2xl flex border border-white/50 shadow-xl w-full max-w-xs sm:max-w-none sm:w-auto">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`flex-1 sm:flex-none px-4 sm:px-8 py-2 sm:py-3 rounded-lg sm:rounded-xl font-semibold text-sm sm:text-base transition-all duration-300 ${
              billingCycle === 'monthly'
                ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg transform scale-105'
                : 'text-gray-600 hover:text-blue-600 hover:bg-white/60'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`flex-1 sm:flex-none px-4 sm:px-8 py-2 sm:py-3 rounded-lg sm:rounded-xl font-semibold text-sm sm:text-base transition-all duration-300 relative ${
              billingCycle === 'yearly'
                ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg transform scale-105'
                : 'text-gray-600 hover:text-blue-600 hover:bg-white/60'
            }`}
          >
            Yearly
            <span className="absolute -top-2 -right-1 sm:-right-2 bg-gradient-to-r from-green-400 to-emerald-500 text-white text-[10px] sm:text-xs px-2 sm:px-3 py-0.5 sm:py-1 rounded-full shadow-lg animate-pulse font-bold whitespace-nowrap">
              Save 33%
            </span>
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-2 sm:px-0">
        {/* Premium Plan Card - Mobile optimized */}
        <div className="relative bg-gradient-to-br from-white/90 via-blue-50/80 to-indigo-50/90 backdrop-blur-sm rounded-2xl sm:rounded-3xl shadow-2xl border-2 border-gradient-to-r from-blue-400 to-indigo-500 p-5 sm:p-8 lg:p-10 hover:scale-[1.02] transition-all duration-300">
          {/* Badge */}
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-600 text-white px-4 sm:px-6 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold shadow-xl whitespace-nowrap">
              ✨ Premium Plan ✨
            </div>
          </div>
          
          <div className="text-center pt-3 sm:pt-4">
            {/* Icon */}
            <div className="mb-4 sm:mb-6">
              <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-2xl mb-3 sm:mb-4">
                <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-gray-900 to-blue-800 bg-clip-text text-transparent">Premium</h3>
            </div>
            
            {/* Pricing */}
            <div className="mb-6 sm:mb-8">
              <div className="text-4xl sm:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{getPrice().amount}</div>
              <div className="text-gray-600 font-semibold text-base sm:text-lg">{getPrice().period}</div>
              {getPrice().note && (
                <div className="text-xs sm:text-sm text-gray-500 mt-1 sm:mt-2 font-medium">{getPrice().note}</div>
              )}
              {getSavings() && (
                <div className="inline-flex items-center mt-2 sm:mt-3 px-3 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-green-100 to-emerald-100 text-green-700 font-bold text-xs sm:text-sm rounded-full border border-green-200 shadow-lg">
                  🎉 {getSavings()}
                </div>
              )}
            </div>
          </div>
          
          {/* Features List - Mobile optimized */}
          <div className="bg-white/60 backdrop-blur-sm rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-white/50 shadow-lg mb-6 sm:mb-8">
            <ul className="space-y-3 sm:space-y-4">
              {getPlanFeatures().map((feature, index) => (
                <li key={index} className="flex items-center group">
                  <div className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full flex items-center justify-center mr-3 sm:mr-4 shadow-lg group-hover:scale-110 transition-transform">
                    <svg className="h-3 w-3 sm:h-4 sm:w-4 text-white font-bold" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-gray-700 font-medium text-sm sm:text-base group-hover:text-gray-900 transition-colors">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA Button - Mobile optimized */}
          <button
            onClick={() => handleSelectPlan({ 
              id: 'Premium', 
              name: 'Premium', 
              price: billingCycle === 'monthly' ? 149 : 99,
              billing: billingCycle
            })}
            disabled={isCurrentPlan('Premium')}
            className={`group relative w-full px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-base sm:text-lg transition-all duration-300 shadow-xl ${
              isCurrentPlan('Premium')
                ? 'bg-gradient-to-r from-gray-200 to-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-600 text-white hover:shadow-2xl hover:scale-105 transform active:scale-95'
            }`}
          >
            {isCurrentPlan('Premium') ? (
              <span className="flex items-center justify-center space-x-2">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Current Plan</span>
              </span>
            ) : (
              <>
                <span className="flex items-center justify-center space-x-2">
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <span>Upgrade to Premium</span>
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-white/10 rounded-xl sm:rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Trust Badges - Mobile optimized */}
      <div className="mt-8 sm:mt-12 text-center">
        <div className="bg-gradient-to-r from-green-50/80 to-emerald-50/80 backdrop-blur-sm rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-white/50 shadow-lg mb-4 sm:mb-6">
          <p className="text-gray-700 font-semibold text-sm sm:text-base lg:text-lg mb-1 sm:mb-2">
            🛡️ 30-day money-back guarantee. Cancel anytime.
          </p>
          <p className="text-gray-600 text-xs sm:text-sm">
            Try risk-free and see the difference premium features make!
          </p>
        </div>
        
        {/* Trust Icons - Mobile stack, Desktop row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-xs sm:text-sm">
          <div className="flex items-center justify-center space-x-2 p-3 sm:p-4 bg-white/60 backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/50 shadow-lg hover:shadow-xl transition-all duration-200">
            <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 sm:w-4 sm:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="font-semibold text-gray-700">🔒 Secure payments</span>
          </div>
          
          <div className="flex items-center justify-center space-x-2 p-3 sm:p-4 bg-white/60 backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/50 shadow-lg hover:shadow-xl transition-all duration-200">
            <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 sm:w-4 sm:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="font-semibold text-gray-700">🎆 No setup fees</span>
          </div>
          
          <div className="flex items-center justify-center space-x-2 p-3 sm:p-4 bg-white/60 backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/50 shadow-lg hover:shadow-xl transition-all duration-200">
            <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-r from-purple-400 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 sm:w-4 sm:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="font-semibold text-gray-700">🚪 Cancel anytime</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPlans;