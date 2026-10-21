class UpkitScorer extends Object
    implements(IUpkitScorer);

var int m_iBase;

function int Score(Actor kTarget)
{
    return m_iBase + (kTarget != none ? 1 : 0);
}

function string Describe()
{
    return "scorer " $ m_iBase;
}

static function int Total(array<IUpkitScorer> arrScorers, Actor kTarget)
{
    local IUpkitScorer S;
    local int iTotal;

    foreach arrScorers(S)
    {
        iTotal += S.Score(kTarget);
    }
    return iTotal;
}

defaultproperties
{
    m_iBase=4
}
