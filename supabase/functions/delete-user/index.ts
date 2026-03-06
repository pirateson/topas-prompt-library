import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Create Supabase client with Service Role Key for admin privileges
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { userId } = await req.json()

        if (!userId) {
            throw new Error('userId is required')
        }

        console.log(`Deleting user: ${userId}`)

        // 1. Delete associated roles in user_market_roles
        const { error: roleError } = await supabase.from("user_market_roles").delete().eq("user_id", userId)
        if (roleError) throw roleError

        // 2. Delete the profile in public.users
        const { error: profileError } = await supabase.from("users").delete().eq("id", userId)
        if (profileError) throw profileError

        // 3. Delete the Auth record (the identity itself)
        const { error: authError } = await supabase.auth.admin.deleteUser(userId)
        if (authError) throw authError

        return new Response(JSON.stringify({ success: true, message: `User ${userId} deleted successfully from both public and auth schemas.` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })
    } catch (error) {
        console.error(`Error deleting user: ${error.message}`)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
