// 알림 묶기 — 표시 전용. DB 행은 그대로 두고, 같은 종류·같은 대상(link)으로
// 연달아 온 알림을 하나로 접어서 보여준다. ("새 메시지" 10줄 → "새 메시지 · 10")

function keyOf(n) {
  return `${n.type}::${n.link || `id:${n.id}`}`;
}

// items: created_at 내림차순으로 정렬된 알림 배열
export function groupNotifications(items) {
  const groups = [];
  for (const n of items || []) {
    const key = keyOf(n);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(n);
    } else {
      groups.push({ key, items: [n] });
    }
  }
  return groups.map((g) => {
    const head = g.items[0]; // 최신
    return {
      id: head.id,
      key: g.key,
      type: head.type,
      title: head.title,
      body: head.body,
      link: head.link,
      created_at: head.created_at,
      count: g.items.length,
      unread: g.items.some((n) => !n.is_read),
      ids: g.items.map((n) => n.id),
    };
  });
}

// 안 읽은 알림을 묶었을 때의 그룹 수 (헤더 뱃지용)
export function unreadGroupCount(items) {
  return groupNotifications(items).filter((g) => g.unread).length;
}
