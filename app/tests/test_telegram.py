from unittest.mock import patch

import crate.telegram as telegram


def test_cmd_status_formats_message_from_query_helper() -> None:
    with patch(
        "crate.telegram.get_library_status_summary",
        return_value={
            "artists": 12,
            "albums": 34,
            "tracks": 567,
            "size_bytes": 8 * 1024 ** 3,
            "running": 2,
            "pending": 5,
        },
    ), patch("crate.telegram._disk_usage", return_value="400 GB free"), patch(
        "crate.telegram.send_message"
    ) as send_message:
        telegram._cmd_status("123", "")

    message = send_message.call_args.args[0]
    assert "12 artists / 34 albums / 567 tracks" in message
    assert "Library: 8.0 GB" in message
    assert "Tasks: 2 running, 5 pending" in message
    assert send_message.call_args.kwargs["chat_id"] == "123"


def test_cmd_tasks_formats_progress_and_phase() -> None:
    with patch(
        "crate.telegram.list_active_tasks",
        return_value=[
            {
                "id": "running-task-123",
                "type": "scan",
                "status": "running",
                "progress": '{"done": 3, "total": 10}',
            },
            {
                "id": "pending-task-456",
                "type": "repair",
                "status": "pending",
                "progress": '{"phase": "planning"}',
            },
        ],
    ), patch("crate.telegram.send_message") as send_message:
        telegram._cmd_tasks("321", "")

    message = send_message.call_args.args[0]
    assert "running-" in message
    assert "(3/10)" in message
    assert "[planning]" in message
    assert send_message.call_args.kwargs["chat_id"] == "321"


def test_cmd_cancel_uses_query_helper_for_lookup() -> None:
    with patch(
        "crate.telegram.find_active_task_by_prefix",
        return_value={"id": "abcdef123456", "type": "scan", "status": "running"},
    ), patch("crate.telegram.update_task") as update_task, patch(
        "crate.telegram.send_message"
    ) as send_message:
        telegram._cmd_cancel("999", "abcdef")

    update_task.assert_called_once_with("abcdef123456", status="cancelled")
    message = send_message.call_args.args[0]
    assert "Cancelled" in message
    assert "abcdef12" in message
    assert send_message.call_args.kwargs["chat_id"] == "999"
