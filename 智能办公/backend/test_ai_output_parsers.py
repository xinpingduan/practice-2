"""AI 助手 Output Parser 的离线测试，不连接模型或业务数据库。"""

import json
import unittest
from unittest.mock import patch

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from services.ai_assistant import (
    PROMPT_VERSION,
    ask_assistant,
    build_assistant_prompt,
    conversation_facts_from_question,
    conversation_facts_message,
    load_conversation_history,
    normalize_memory_options,
    normalize_conversation_id,
    normalize_output_format,
    response_style_for,
    parse_model_output,
    render_structured_answer,
    stream_assistant,
    structured_result,
)
from services.conversation_memory import (
    ConversationBufferMemory, ConversationBufferWindowMemory, ConversationTokenBufferMemory,
    ConversationSummaryMemory,
)


class AssistantOutputParserTests(unittest.TestCase):
    def test_normal_parser_returns_readable_text(self):
        raw = "结论：当前没有紧急事项。\n\n建议：\n1. 核对明日班次。\n\n风险提示：无。"

        data = parse_model_output(raw, "normal")
        result = structured_result(data, "normal")

        self.assertEqual(data, raw)
        self.assertEqual(result["answer"], raw)
        self.assertEqual(result["output_format"], "normal")

    def test_json_parser_returns_fixed_business_schema(self):
        raw = json.dumps({
            "conclusion": "本周暂无必须立即处理的审批。",
            "suggestions": ["核对明日班次", "查看未读消息"],
            "risks": [],
            "ignored": "不会返回到客户端",
        }, ensure_ascii=False)

        data = parse_model_output(raw, "json")
        result = structured_result(data, "json")

        self.assertEqual(set(result), {"output_format", "data", "answer", "prompt_version"})
        self.assertEqual(result["prompt_version"], PROMPT_VERSION)
        self.assertEqual(data["risks"], ["无"])
        self.assertNotIn("ignored", data)
        self.assertEqual(json.loads(result["answer"]), data)

    def test_list_parser_returns_list_and_numbered_display(self):
        raw = "结论：暂无紧急事项,建议：核对明日班次,建议：查看未读消息,风险：无"

        data = parse_model_output(raw, "list")

        self.assertEqual(len(data), 4)
        self.assertEqual(data[0], "结论：暂无紧急事项")
        self.assertTrue(render_structured_answer(data, "list").startswith("1. 结论："))

    def test_xml_parser_returns_safe_fixed_tree(self):
        raw = (
            "<response><conclusion>明日有一个早班。</conclusion>"
            "<suggestions><item>提前到岗</item></suggestions>"
            "<risks><item>无</item></risks></response>"
        )

        data = parse_model_output(raw, "xml")
        rendered = render_structured_answer(data, "xml")

        self.assertEqual(data["response"][0]["conclusion"], "明日有一个早班。")
        self.assertIn("<suggestions><item>提前到岗</item></suggestions>", rendered)
        self.assertNotIn("DOCTYPE", rendered)

    def test_output_format_alias_and_rejection(self):
        self.assertEqual(normalize_output_format(None), "normal")
        self.assertEqual(normalize_output_format("正常回答"), "normal")
        self.assertEqual(normalize_output_format("列表"), "list")
        self.assertEqual(normalize_output_format("XML"), "xml")
        self.assertIsNone(normalize_output_format("yaml"))

    def test_memory_options_are_bounded_before_building_history(self):
        self.assertEqual(normalize_memory_options({
            "window_messages": 0, "token_limit": 999999, "summary_max_characters": "bad",
        }), {
            "window_messages": 1, "token_limit": 16000, "summary_max_characters": 3000,
        })

    def test_prompt_separates_context_history_and_current_question(self):
        prompt_value = build_assistant_prompt("json").invoke({
            "context": '{"当前页面":"排班"}',
            "history": [HumanMessage(content="上一问"), AIMessage(content="上一答")],
            "question": "当前问题",
            "response_style": "测试风格",
        })

        self.assertTrue(all(isinstance(message, SystemMessage) for message in prompt_value.messages[:5]))
        self.assertIn("<business_context>", prompt_value.messages[2].content)
        self.assertEqual(prompt_value.messages[-3].content, "上一问")
        self.assertEqual(prompt_value.messages[-2].content, "上一答")
        self.assertEqual(prompt_value.messages[-1].content, "当前问题")
        self.assertNotIn("结论 / 依据 / 建议操作", prompt_value.messages[0].content)

    def test_user_stated_name_becomes_conversation_fact(self):
        facts = conversation_facts_from_question("我是小段你记住")

        self.assertEqual(facts, {"preferred_name": "小段"})
        self.assertIn("小段", conversation_facts_message(facts))

    def test_normal_chat_is_not_forced_into_business_sections(self):
        self.assertIn("自然、直接", response_style_for("我叫什么", "normal"))
        self.assertIn("结论、建议、风险提示", response_style_for("我的排班怎么样", "normal"))

    def test_conversation_id_validation_and_trusted_history_mapping(self):
        conversation_id = "5dc9ab64-795f-4d3c-bb13-a6ebd56d2492"
        self.assertEqual(normalize_conversation_id(conversation_id.upper()), conversation_id)
        self.assertFalse(normalize_conversation_id("not-a-uuid"))
        stored = {
            "conversation_id": conversation_id,
            "messages": [
                {"role": "user", "content": "上一问"},
                {"role": "assistant", "content": "上一答"},
            ],
        }
        with patch("services.ai_assistant.get_conversation_messages", return_value=(stored, None, 200)):
            restored_id, messages, memory_type, summary, error, status = load_conversation_history(1, conversation_id)
        self.assertEqual((restored_id, memory_type, summary, error, status), (conversation_id, "buffer", "", None, 200))
        self.assertIsInstance(messages[0], HumanMessage)
        self.assertIsInstance(messages[1], AIMessage)

    def test_history_prefers_recent_messages_within_character_budget(self):
        conversation_id = "5dc9ab64-795f-4d3c-bb13-a6ebd56d2492"
        stored = {
            "conversation_id": conversation_id,
            "messages": [
                {"role": "user", "content": "old-question" * 900},
                {"role": "assistant", "content": "old-answer" * 900},
                {"role": "user", "content": "recent-question" * 900},
                {"role": "assistant", "content": "recent-answer" * 900},
            ],
        }
        with patch("services.ai_assistant.get_conversation_messages", return_value=(stored, None, 200)):
            _, messages, memory_type, _summary, error, status = load_conversation_history(1, conversation_id)

        self.assertEqual((memory_type, error, status), ("buffer", None, 200))
        self.assertEqual(len(messages), 2)
        self.assertTrue(messages[0].content.startswith("recent-question"))
        self.assertTrue(messages[1].content.startswith("recent-answer"))
        self.assertLessEqual(sum(len(message.content) for message in messages), 16000)

    def test_history_applies_user_selected_window_size(self):
        conversation_id = "5dc9ab64-795f-4d3c-bb13-a6ebd56d2492"
        stored = {
            "conversation_id": conversation_id,
            "memory_type": "window",
            "messages": [
                {"role": "user", "content": "第一问"},
                {"role": "assistant", "content": "第一答"},
                {"role": "user", "content": "第二问"},
            ],
        }
        with patch("services.ai_assistant.get_conversation_messages", return_value=(stored, None, 200)):
            _, messages, memory_type, _summary, error, status = load_conversation_history(
                1, conversation_id, "window", {"window_messages": 1},
            )

        self.assertEqual((memory_type, error, status), ("window", None, 200))
        self.assertEqual([message.content for message in messages], ["第二问"])

    def test_conversation_facts_survive_a_one_message_window(self):
        conversation_id = "5dc9ab64-795f-4d3c-bb13-a6ebd56d2492"
        stored = {
            "conversation_id": conversation_id,
            "memory_type": "window",
            "memory_facts": '{"preferred_name":"小段"}',
            "messages": [{"role": "assistant", "content": "好的，我记住了。"}],
        }
        with patch("services.ai_assistant.get_conversation_messages", return_value=(stored, None, 200)):
            _, messages, _memory_type, _summary, error, status = load_conversation_history(
                1, conversation_id, "window", {"window_messages": 1},
            )

        self.assertEqual((error, status), (None, 200))
        self.assertIsInstance(messages[0], SystemMessage)
        self.assertIn("小段", messages[0].content)
        self.assertEqual(messages[1].content, "好的，我记住了。")

    def test_old_conversation_message_backfills_facts_for_the_current_reply(self):
        conversation_id = "5dc9ab64-795f-4d3c-bb13-a6ebd56d2492"
        stored = {
            "conversation_id": conversation_id,
            "memory_type": "window",
            "messages": [
                {"role": "user", "content": "我是小段你记住"},
                {"role": "assistant", "content": "好的。"},
            ],
        }
        with patch("services.ai_assistant.get_conversation_messages", return_value=(stored, None, 200)):
            _, messages, _memory_type, _summary, error, status = load_conversation_history(
                1, conversation_id, "window", {"window_messages": 1},
            )

        self.assertEqual((error, status), (None, 200))
        self.assertIsInstance(messages[0], SystemMessage)
        self.assertIn("小段", messages[0].content)
        self.assertEqual(messages[-1].content, "好的。")

    def test_buffer_memory_keeps_all_messages_within_server_cap(self):
        messages = [HumanMessage(content="第一问"), AIMessage(content="第一答"), HumanMessage(content="第二问")]
        memory = ConversationBufferMemory(messages, max_characters=100)
        self.assertEqual(memory.load_memory_variables()["history"], messages)

    def test_window_memory_keeps_only_the_latest_messages(self):
        messages = [HumanMessage(content=f"消息 {index}") for index in range(5)]
        memory = ConversationBufferWindowMemory(messages, k=2)
        history = memory.load_memory_variables()["history"]
        self.assertEqual([message.content for message in history], ["消息 3", "消息 4"])

    def test_token_memory_respects_token_budget_and_prefers_recent_messages(self):
        messages = [HumanMessage(content="old-token " * 400), AIMessage(content="最近的回答")]
        memory = ConversationTokenBufferMemory(messages, max_token_limit=256)
        history = memory.load_memory_variables()["history"]
        self.assertEqual([message.content for message in history], ["最近的回答"])

    def test_summary_memory_compresses_older_messages_and_keeps_recent_context(self):
        messages = [
            HumanMessage(content="用户早期询问排班规则"),
            AIMessage(content="助手早期说明休息时长要求"),
            HumanMessage(content="用户最近询问明日班次"),
            AIMessage(content="助手最近回答明日班次安排"),
        ]
        memory = ConversationSummaryMemory(messages, k=2)
        history = memory.load_memory_variables()["history"]

        self.assertIsInstance(history[0], SystemMessage)
        self.assertIn("用户：用户早期询问排班规则", history[0].content)
        self.assertEqual([message.content for message in history[1:]], [
            "用户最近询问明日班次", "助手最近回答明日班次安排",
        ])
        self.assertEqual(memory.summary, history[0].content.split("：\n", 1)[1])

    def test_invalid_history_load_keeps_six_item_return_contract(self):
        with patch("services.ai_assistant.get_conversation_messages", return_value=(None, "对话已失效", 404)):
            result = load_conversation_history(1, "5dc9ab64-795f-4d3c-bb13-a6ebd56d2492")

        self.assertEqual(result, (None, [], None, "", "对话已失效", 404))

    @patch("services.ai_assistant.save_conversation_exchange", return_value="5dc9ab64-795f-4d3c-bb13-a6ebd56d2492")
    @patch("services.ai_assistant.authorized_context", return_value={"当前页面": "测试"})
    @patch("services.ai_assistant.allow_request", return_value=True)
    def test_non_stream_chain_parses_before_returning(self, _allow_request, _authorized_context, _save_exchange):
        model = FakeListChatModel(responses=[
            '{"conclusion":"结构正确","suggestions":["继续验证"],"risks":["无"]}',
        ])
        with patch("services.ai_assistant.get_chat_model", return_value=model):
            result, error, status = ask_assistant(
                {"id": 1, "role": "employee", "department": "技术部"},
                "测试结构化返回",
                output_format="json",
            )

        self.assertEqual((error, status), (None, 200))
        self.assertEqual(result["data"]["conclusion"], "结构正确")
        self.assertEqual(result["conversation_id"], "5dc9ab64-795f-4d3c-bb13-a6ebd56d2492")

    @patch("services.ai_assistant.save_conversation_exchange", return_value="5dc9ab64-795f-4d3c-bb13-a6ebd56d2492")
    @patch("services.ai_assistant.authorized_context", return_value={"当前页面": "测试"})
    @patch("services.ai_assistant.allow_request", return_value=True)
    def test_normal_is_default_for_non_stream_answer(self, _allow_request, _authorized_context, _save_exchange):
        model = FakeListChatModel(responses=["结论：默认使用正常回答。\n建议：无。\n风险提示：无。"])
        with patch("services.ai_assistant.get_chat_model", return_value=model):
            result, error, status = ask_assistant(
                {"id": 1, "role": "employee", "department": "技术部"},
                "测试默认回答",
            )

        self.assertEqual((error, status), (None, 200))
        self.assertEqual(result["output_format"], "normal")
        self.assertIn("默认使用正常回答", result["answer"])

    @patch("services.ai_assistant.save_conversation_exchange", return_value="5dc9ab64-795f-4d3c-bb13-a6ebd56d2492")
    @patch("services.ai_assistant.authorized_context", return_value={"当前页面": "测试"})
    @patch("services.ai_assistant.allow_request", return_value=True)
    def test_stream_chain_finishes_with_structured_event(self, _allow_request, _authorized_context, _save_exchange):
        xml = (
            "<response><conclusion>流式完成</conclusion>"
            "<suggestions><item>查看最终结构</item></suggestions>"
            "<risks><item>无</item></risks></response>"
        )
        model = FakeListChatModel(responses=[xml])
        with patch("services.ai_assistant.get_chat_model", return_value=model):
            iterator, error, status = stream_assistant(
                {"id": 1, "role": "employee", "department": "技术部"},
                "测试流式结构化返回",
                output_format="xml",
            )
            events = list(iterator)

        self.assertEqual((error, status), (None, 200))
        self.assertEqual(events[-1][0], "structured")
        self.assertEqual(events[-1][1]["output_format"], "xml")
        self.assertIn("<conclusion>流式完成</conclusion>", events[-1][1]["answer"])

    @patch("services.ai_assistant.save_conversation_exchange", return_value="5dc9ab64-795f-4d3c-bb13-a6ebd56d2492")
    @patch("services.ai_assistant.authorized_context", return_value={"当前页面": "测试"})
    @patch("services.ai_assistant.allow_request", return_value=True)
    def test_normal_stream_finishes_with_readable_answer(self, _allow_request, _authorized_context, _save_exchange):
        model = FakeListChatModel(responses=["结论：流式正常回答。\n建议：继续处理。\n风险提示：无。"])
        with patch("services.ai_assistant.get_chat_model", return_value=model):
            iterator, error, status = stream_assistant(
                {"id": 1, "role": "employee", "department": "技术部"},
                "测试正常流式返回",
            )
            events = list(iterator)

        self.assertEqual((error, status), (None, 200))
        self.assertEqual(events[-1][0], "structured")
        self.assertEqual(events[-1][1]["output_format"], "normal")
        self.assertIn("流式正常回答", events[-1][1]["answer"])


if __name__ == "__main__":
    unittest.main()
