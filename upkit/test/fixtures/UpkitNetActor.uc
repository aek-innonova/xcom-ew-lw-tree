class UpkitNetActor extends Actor;

var int m_iScore;
var string m_strLabel;
var bool m_bActive;

replication
{
    if (bNetDirty && Role == ROLE_Authority)
        m_iScore, m_strLabel;
    if (bNetInitial)
        m_bActive;
}

function AddScore(int iPoints)
{
    m_iScore += iPoints;
}
