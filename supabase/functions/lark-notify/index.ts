import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const LARK_WEBHOOK_URL = "https://open.larksuite.com/open-apis/bot/v2/hook/694caef5-0630-4ccc-a7ff-e3c9d015b118"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { user } = await req.json()

        const card = {
            "msg_type": "interactive",
            "card": {
                "header": {
                    "title": { "tag": "plain_text", "content": "🚀 Có tài khoản mới được tạo" },
                    "template": "blue"
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": { "tag": "lark_md", "content": `**Email:** ${user.email}\n**Tên:** ${user.name || 'N/A'}` }
                    },
                    {
                        "tag": "action",
                        "actions": [{
                            "tag": "button",
                            "text": { "tag": "plain_text", "content": "Thiết lập quyền cho user" },
                            "type": "primary",
                            "url": "https://topas-prompt-library.pages.dev"
                        }]
                    }
                ]
            }
        };

        const response = await fetch(LARK_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(card)
        })

        const result = await response.json()

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        })
    }
})
