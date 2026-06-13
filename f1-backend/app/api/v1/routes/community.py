"""
Topluluk endpoint'leri.

GET  /sessions/{id}/comments                → yorum listesi (sayfalı)
POST /sessions/{id}/comments               → yorum ekle (auth)
POST /comments/{id}/upvote                 → beğen (auth)

GET  /sessions/{id}/polls                  → anket listesi
POST /sessions/{id}/polls                  → anket oluştur (auth)
POST /polls/{id}/vote                      → oy ver (auth)

GET  /sessions/{id}/reactions              → tepki haritası
POST /sessions/{id}/reactions              → tepki ekle (auth)
"""

import json
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import optional_auth, require_auth
from app.core.database import get_db
from app.core.redis_client import cache_key, get_redis
from app.models.community import Comment, Poll, PollVote
from app.models.user import User
from app.schemas.community import (
    CommentCreate,
    CommentOut,
    CommentPage,
    CommentUpdate,
    PollCreate,
    PollOptionOut,
    PollOut,
    ReactionCreate,
    ReactionPoint,
)
from app.services import rate_limiter

router = APIRouter(tags=["topluluk"])


# ─── Yardımcı: Community WebSocket Yayını ────────────────────────────────────

async def _publish_community(session_id: int, kind: str, data: dict) -> None:
    """Redis pub/sub üzerinden community kanalına yayın yapar."""
    r = await get_redis()
    channel = f"f1:community:{session_id}:{kind}"
    payload = json.dumps({
        "type": kind,
        "data": data,
        "ts": datetime.now(UTC).isoformat(),
    }, ensure_ascii=False, default=str)
    await r.publish(channel, payload)


def _poll_to_out(poll: Poll, user_vote: int | None, username: str = "") -> PollOut:
    """Poll modelini PollOut şemasına dönüştürür."""
    options_raw: list[dict] = poll.options or []
    total = sum(o.get("votes", 0) for o in options_raw)
    options_out = [
        PollOptionOut(
            index=i,
            text=o.get("text", ""),
            votes=o.get("votes", 0),
            pct=round(o.get("votes", 0) / total * 100, 1) if total > 0 else 0.0,
        )
        for i, o in enumerate(options_raw)
    ]
    is_closed = poll.closes_at is not None and poll.closes_at <= datetime.now(UTC)
    return PollOut(
        id=poll.id,
        question=poll.question,
        options=options_out,
        total_votes=total,
        user_vote=user_vote,
        created_at=poll.created_at,
        closes_at=poll.closes_at,
        is_closed=is_closed,
        created_by=poll.created_by,
        created_by_username=username,
    )


# ─── Yorumlar ────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/comments", response_model=CommentPage)
async def list_comments(
    session_id: int,
    lap: int | None = Query(None, description="Tur filtresi"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Comment, User.username)
        .join(User, Comment.user_id == User.id)
        .where(Comment.session_id == session_id)
    )
    if lap is not None:
        query = query.where(Comment.lap_number == lap)

    total_q = await db.execute(
        select(func.count()).select_from(Comment).where(Comment.session_id == session_id)
    )
    total = total_q.scalar()

    query = query.order_by(Comment.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(query)).all()

    items = []
    for comment, username in rows:
        out = CommentOut.model_validate(comment)
        out.username = username
        items.append(out)

    return CommentPage(items=items, total=total, page=page, page_size=page_size)


@router.post("/sessions/{session_id}/comments", response_model=CommentOut, status_code=201)
async def create_comment(
    session_id: int,
    body: CommentCreate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    # Rate limit: 10 saniyede 1 yorum
    allowed = await rate_limiter.is_allowed(str(user.id), "comment", limit=1, window_seconds=10)
    if not allowed:
        wait = await rate_limiter.remaining(str(user.id), "comment")
        raise HTTPException(429, f"Çok hızlı! {wait} saniye bekleyin.")

    comment = Comment(
        session_id=session_id,
        user_id=user.id,
        content=body.content,
        lap_number=body.lap_number,
        dist_pct=body.dist_pct,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    out = CommentOut.model_validate(comment)
    out.username = user.username

    # WebSocket yayını
    await _publish_community(session_id, "comment", out.model_dump(mode="json"))
    return out


@router.patch("/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: uuid.UUID,
    body: CommentUpdate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = result.scalar_one_or_none()
    if comment is None:
        raise HTTPException(404, "Yorum bulunamadı")
    if comment.user_id != user.id:
        raise HTTPException(403, "Bu yorumu düzenleme yetkiniz yok")

    comment.content = body.content
    await db.commit()
    await db.refresh(comment)

    out = CommentOut.model_validate(comment)
    out.username = user.username

    await _publish_community(comment.session_id, "comment_update", out.model_dump(mode="json"))
    return out


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = result.scalar_one_or_none()
    if comment is None:
        raise HTTPException(404, "Yorum bulunamadı")
    if comment.user_id != user.id:
        raise HTTPException(403, "Bu yorumu silme yetkiniz yok")

    session_id = comment.session_id
    await db.delete(comment)
    await db.commit()

    await _publish_community(session_id, "comment_delete", {"id": str(comment_id)})


@router.post("/comments/{comment_id}/upvote", status_code=200)
async def upvote_comment(
    comment_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    # Rate limit: 2 saniyede 1 upvote
    allowed = await rate_limiter.is_allowed(str(user.id), "upvote", limit=1, window_seconds=2)
    if not allowed:
        raise HTTPException(429, "Çok hızlı!")

    result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = result.scalar_one_or_none()
    if comment is None:
        raise HTTPException(404, "Yorum bulunamadı")

    # Kendi yorumuna upvote veremez
    if comment.user_id == user.id:
        raise HTTPException(400, "Kendi yorumunuza oy veremezsiniz")

    comment.upvotes += 1
    await db.commit()
    return {"upvotes": comment.upvotes}


# ─── Anketler ────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/polls", response_model=list[PollOut])
async def list_polls(
    session_id: int,
    user: User | None = Depends(optional_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Poll, User.username)
        .join(User, Poll.created_by == User.id)
        .where(Poll.session_id == session_id)
        .order_by(Poll.created_at.desc())
        .limit(20)
    )
    rows = result.all()

    polls_out = []
    for poll, username in rows:
        user_vote = None
        if user:
            vote_result = await db.execute(
                select(PollVote.option_index).where(
                    PollVote.poll_id == poll.id,
                    PollVote.user_id == user.id,
                )
            )
            vote_row = vote_result.scalar_one_or_none()
            user_vote = vote_row
        polls_out.append(_poll_to_out(poll, user_vote, username))

    return polls_out


@router.post("/sessions/{session_id}/polls", response_model=PollOut, status_code=201)
async def create_poll(
    session_id: int,
    body: PollCreate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    # Rate limit: 60 saniyede 1 anket
    allowed = await rate_limiter.is_allowed(str(user.id), "poll", limit=1, window_seconds=60)
    if not allowed:
        raise HTTPException(429, "60 saniyede yalnızca 1 anket oluşturabilirsiniz")

    options_data = [{"text": opt, "votes": 0} for opt in body.options]
    closes_at = datetime.now(UTC) + timedelta(minutes=body.closes_in_minutes)

    poll = Poll(
        session_id=session_id,
        created_by=user.id,
        question=body.question,
        options=options_data,
        closes_at=closes_at,
    )
    db.add(poll)
    await db.commit()
    await db.refresh(poll)

    out = _poll_to_out(poll, None, user.username)
    await _publish_community(session_id, "poll_new", out.model_dump(mode="json"))
    return out


@router.post("/polls/{poll_id}/vote", response_model=PollOut)
async def vote_poll(
    poll_id: uuid.UUID,
    option_index: int = Query(..., ge=0, le=3),
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Poll, User.username)
        .join(User, Poll.created_by == User.id)
        .where(Poll.id == poll_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(404, "Anket bulunamadı")
    poll, creator_username = row

    # Anket kapalı mı?
    if poll.closes_at and poll.closes_at <= datetime.now(UTC):
        raise HTTPException(400, "Bu anket kapatıldı")

    # Daha önce oy vermiş mi?
    existing = await db.execute(
        select(PollVote).where(PollVote.poll_id == poll_id, PollVote.user_id == user.id)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(400, "Bu ankete zaten oy verdiniz")

    # Option geçerliliği
    options: list[dict] = poll.options or []
    if option_index >= len(options):
        raise HTTPException(400, "Geçersiz seçenek")

    # Oy say — JSONB sütununu SQLAlchemy'nin değişikliği fark etmesi için
    # yeni bir liste/dict ile değiştiriyoruz (yerinde mutate algılanmaz)
    new_options = [dict(o) for o in options]
    new_options[option_index]["votes"] = new_options[option_index].get("votes", 0) + 1
    poll.options = new_options

    vote = PollVote(poll_id=poll_id, user_id=user.id, option_index=option_index)
    db.add(vote)
    await db.commit()
    await db.refresh(poll)

    out = _poll_to_out(poll, option_index, creator_username)
    await _publish_community(poll.session_id, "poll_update", out.model_dump(mode="json"))
    return out


@router.delete("/polls/{poll_id}", status_code=204)
async def delete_poll(
    poll_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Poll).where(Poll.id == poll_id))
    poll = result.scalar_one_or_none()
    if poll is None:
        raise HTTPException(404, "Anket bulunamadı")
    if poll.created_by != user.id:
        raise HTTPException(403, "Bu anketi silme yetkiniz yok")

    session_id = poll.session_id
    await db.execute(delete(PollVote).where(PollVote.poll_id == poll_id))
    await db.delete(poll)
    await db.commit()

    await _publish_community(session_id, "poll_delete", {"id": str(poll_id)})


# ─── Tepkiler (Reaction) ─────────────────────────────────────────────────────

# Tepkileri Redis'te saklıyoruz (DB değil) — volatile, TTL'li
REACTION_TTL = 4 * 3600  # 4 saat


@router.post("/sessions/{session_id}/reactions", status_code=201)
async def add_reaction(
    session_id: int,
    body: ReactionCreate,
    user: User = Depends(require_auth),
):
    # Rate limit: 3 saniyede 1 tepki
    allowed = await rate_limiter.is_allowed(str(user.id), "reaction", limit=1, window_seconds=3)
    if not allowed:
        raise HTTPException(429, "Çok hızlı!")

    r = await get_redis()
    key = cache_key("reactions", session_id)
    reaction = {
        "emoji": body.emoji,
        "lap_number": body.lap_number,
        "dist_pct": body.dist_pct,
        "user_id": str(user.id),
        "ts": datetime.now(UTC).isoformat(),
    }
    await r.rpush(key, json.dumps(reaction))
    await r.expire(key, REACTION_TTL)

    # WebSocket yayını
    from app.core.redis_client import get_redis as _r
    rr = await _r()
    channel = f"f1:community:{session_id}:reaction"
    await rr.publish(channel, json.dumps({
        "type": "reaction",
        "data": reaction,
        "ts": reaction["ts"],
    }))

    return {"status": "ok", "emoji": body.emoji}


@router.get("/sessions/{session_id}/reactions", response_model=list[ReactionPoint])
async def get_reactions(session_id: int):
    """Oturumdaki tüm tepkileri gruplandırılmış olarak döner."""
    r = await get_redis()
    key = cache_key("reactions", session_id)
    raw_list = await r.lrange(key, 0, -1)

    # Emoji + dist_pct gruplama
    grouped: dict[tuple, int] = defaultdict(int)
    for raw in raw_list:
        try:
            item = json.loads(raw)
            k = (item.get("emoji", "?"), item.get("dist_pct"), item.get("lap_number"))
            grouped[k] += 1
        except Exception:
            pass

    return [
        ReactionPoint(emoji=emoji, dist_pct=dist_pct, lap_number=lap, count=count)
        for (emoji, dist_pct, lap), count in sorted(grouped.items(), key=lambda x: -x[1])
    ]
