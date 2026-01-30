import { useState, useEffect } from 'react';

interface SkillsProps {
  gateway: {
    connected: boolean;
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  };
}

interface Skill {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  tags?: string[];
  enabled: boolean;
  source: string;
}

export default function Skills({ gateway }: SkillsProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const fetchSkills = async () => {
    if (!gateway.connected) return;

    try {
      const result = await gateway.request<Skill[]>('skills.list', {
        enabledOnly: filter === 'enabled',
      });
      setSkills(
        filter === 'disabled'
          ? (result || []).filter((s) => !s.enabled)
          : result || []
      );
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, [gateway.connected, filter]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await gateway.request(enabled ? 'skills.disable' : 'skills.enable', { id });
      await fetchSkills();
    } catch (error) {
      alert(`Failed to toggle: ${(error as Error).message}`);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading skills...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Skills</h2>

        <div className="flex gap-2">
          {(['all', 'enabled', 'disabled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded ${
                filter === f
                  ? 'bg-atlas-red text-white'
                  : 'bg-atlas-card border border-atlas-border text-gray-400 hover:text-white'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="bg-atlas-card border border-atlas-border rounded-lg p-8 text-center">
          <p className="text-gray-500">No skills found</p>
          <p className="text-gray-600 text-sm mt-2">
            Install skills from ClawdHub or local SKILL.md files.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="bg-atlas-card border border-atlas-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{skill.name}</h3>
                    <span className="text-gray-500 text-xs">v{skill.version}</span>
                  </div>
                  {skill.author && (
                    <p className="text-gray-500 text-sm">by {skill.author}</p>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={() => handleToggle(skill.id, skill.enabled)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-atlas-red"></div>
                </label>
              </div>

              {skill.description && (
                <p className="text-gray-400 text-sm mb-3">{skill.description}</p>
              )}

              {skill.tags && skill.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {skill.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-white/5 rounded text-xs text-gray-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Source: {skill.source}</span>
                <span className="font-mono">{skill.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
