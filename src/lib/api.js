import { supabase } from './supabase.js';

export async function getCurrentUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: userRecord } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

    return { ...session.user, ...userRecord };
}

export async function getMarkets() {
    const { data, error } = await supabase.from('markets').select('*').order('name');
    if (error) throw error;
    return data;
}

export async function getTopics(marketId) {
    const { data, error } = await supabase.from('topics').select('*').eq('market_id', marketId).order('name');
    if (error) throw error;
    return data;
}

export async function getPrompts(marketId, topicId, searchQuery = '') {
    let query = supabase.rpc('search_prompts', {
        p_market_id: marketId,
        p_topic_id: topicId,
        p_search_text: searchQuery || null
    });

    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function getPromptVersions(promptId) {
    const { data, error } = await supabase
        .from('prompt_versions')
        .select('v:version, c:content, date:created_at')
        .eq('prompt_id', promptId)
        .order('version', { ascending: false });
    if (error) throw error;
    return data;
}

export async function savePrompt({ id, topic_id, title, content }) {
    if (id) {
        const { data, error } = await supabase
            .from('prompts')
            .update({ title, content })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    } else {
        const { data, error } = await supabase
            .from('prompts')
            .insert({ topic_id, title, content })
            .select()
            .single();
        if (error) throw error;
        return data;
    }
}

export async function deletePrompt(id) {
    const { error } = await supabase.from('prompts').delete().eq('id', id);
    if (error) throw error;
    return true;
}

// User role management
export async function getUserRole(marketId) {
    const { data } = await supabase
        .from('user_market_roles')
        .select('role')
        .eq('market_id', marketId)
        .maybeSingle();
    return data?.role || null;
}

export async function getUsers() {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}
