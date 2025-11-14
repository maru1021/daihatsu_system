from datetime import date
import calendar

def days_in_month_dates(year: int, month: int):
    """
    指定した年・月のすべての日を、date型のリストで返す。
    """
    _, last_day = calendar.monthrange(year, month)
    return [date(year, month, day) for day in range(1, last_day + 1)]
