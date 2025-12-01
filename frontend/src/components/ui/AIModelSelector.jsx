import React, { useState, useEffect } from 'react';
import { Settings, Cpu, CheckCircle, AlertCircle, Sparkles, Zap } from 'lucide-react';
import aiService from '../../services/aiService';
import { toast } from 'react-hot-toast';

const AIModelSelector = ({ selectedModel, onModelChange, showDefaultOption = false }) => {
  const [availableModels, setAvailableModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [settingDefault, setSettingDefault] = useState(false);

  useEffect(() => {
    fetchAvailableModels();
  }, []);

  const fetchAvailableModels = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await aiService.getAvailableModels();
      setAvailableModels(response.models || []);
    } catch (error) {
      console.error('Error fetching AI models:', error);
      setError('Failed to load AI models');
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (modelId) => {
    try {
      setSettingDefault(true);
      await aiService.setDefaultModel(modelId);
      toast.success('Default AI model updated successfully');
      // Refresh models to update default status
      await fetchAvailableModels();
    } catch (error) {
      console.error('Error setting default model:', error);
      toast.error('Failed to set default model. Super admin access required.');
    } finally {
      setSettingDefault(false);
    }
  };

  const getModelIcon = (provider) => {
    switch (provider?.toLowerCase()) {
      case 'anthropic':
        return <Sparkles className="w-4 h-4" />;
      case 'google':
        return <Zap className="w-4 h-4" />;
      default:
        return <Cpu className="w-4 h-4" />;
    }
  };

  const getModelBadgeColor = (provider, isDefault) => {
    if (isDefault) return 'bg-green-100 text-green-800 border-green-200';
    
    switch (provider?.toLowerCase()) {
      case 'anthropic':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'google':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded mb-2"></div>
        <div className="h-10 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        AI Model
      </label>
      
      <div className="space-y-2">
        {availableModels.map((model) => (
          <div
            key={model.id}
            className={`
              relative flex items-start p-3 border rounded-lg cursor-pointer transition-all
              ${selectedModel === model.id
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
            onClick={() => onModelChange(model.id)}
          >
            <div className="flex items-center h-5">
              <input
                id={`model-${model.id}`}
                name="ai-model"
                type="radio"
                checked={selectedModel === model.id}
                onChange={() => onModelChange(model.id)}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
            </div>
            
            <div className="ml-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {getModelIcon(model.provider)}
                <label
                  htmlFor={`model-${model.id}`}
                  className="text-sm font-medium text-gray-900 cursor-pointer"
                >
                  {model.name}
                </label>
                
                <div className="flex gap-1">
                  <span className={`
                    inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
                    ${getModelBadgeColor(model.provider, model.isDefault)}
                  `}>
                    {model.provider}
                  </span>
                  
                  {model.isDefault && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Default
                    </span>
                  )}
                </div>
              </div>
              
              <p className="text-xs text-gray-600 leading-relaxed">
                {model.description}
              </p>
              
              {showDefaultOption && !model.isDefault && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSetDefault(model.id);
                  }}
                  disabled={settingDefault}
                  className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                >
                  {settingDefault ? 'Setting as default...' : 'Set as default for all users'}
                </button>
              )}
            </div>
          </div>
        ))}
        
        {availableModels.length === 0 && (
          <div className="text-center py-4 text-gray-500">
            <Cpu className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm">No AI models available</p>
          </div>
        )}
      </div>
      
      {availableModels.length > 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
          <Settings className="w-3 h-3 inline mr-1" />
          Selected model will be used for all AI enhancements
        </div>
      )}
    </div>
  );
};

export default AIModelSelector;